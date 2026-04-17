// Phase 4：正向行为奖励
//
// 4 个事件式触发（+ 1 个 daily cron 用 rewardWeeklyActiveClean）：
//   - rewardPostLikedByStranger  每帖 1 次（cooldown 365 天）
//   - rewardCommentReplied       作者每天 1 次
//   - rewardFriendAccepted       申请方每天 1 次
//   - rewardWeeklyActiveClean    用户每周 1 次
//
// 统一入口 tryAddReward：
//   1. 冷却判断（Redis SET NX EX，失败 fallback 查 decay_log）
//   2. 读 user（status=banned 跳过、risk_score<=0 跳过）
//   3. 新号保护期：ceil(baseDelta * 0.3)，Math.ceil 对负数是更靠近 0（-0.9 → 0, -0.6 → 0, -2.1 → -2）
//      →  实际"四舍到 0"变成了"只有够小才减"，符合 docs"× 30% 效果"
//   4. 通过 recordEvent 写 risk_events(reason='reward') → 更新 users.risk_score → 触发 applyEnforcement 闭环
//   5. 额外写 risk_score_decay_log
//
// observe 模式下 recordEvent 只写日志不改分数，符合 Q22 语义。

const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');
const { isInSameCluster } = require('../cluster/sameCluster');
const { recordEvent } = require('../riskEngine/scoreStore');
const { getRedis, isRedisNoop } = require('../../config/redis');

const DAY_MS = 86400 * 1000;

async function checkAndSetCooldown(key, ttlSec) {
  if (!key || !ttlSec) return true;

  const redis = getRedis();
  if (!isRedisNoop() && redis && typeof redis.set === 'function') {
    try {
      // Upstash Redis：SET key val NX EX ttl
      const res = await redis.set(key, '1', { nx: true, ex: ttlSec });
      return res === 'OK';
    } catch (err) {
      console.warn('[reward] redis cooldown failed, fallback:', err && err.message);
    }
  }

  // Fallback：查 risk_score_decay_log metadata.cooldown_key
  const since = new Date(Date.now() - ttlSec * 1000).toISOString();
  const { count, error } = await supabase
    .from('risk_score_decay_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .filter('metadata->>cooldown_key', 'eq', key);
  if (error) {
    // 保守放行避免误拦
    return true;
  }
  return (count || 0) === 0;
}

/**
 * @param {string} userId       受奖励用户
 * @param {string} decayType    decay_log.decay_type 取值
 * @param {number} baseDelta    负数（如 -3）
 * @param {Object} opts
 * @param {string} [opts.cooldownKey]
 * @param {number} [opts.cooldownSec]
 * @param {Object} [opts.metadata]
 */
async function tryAddReward(userId, decayType, baseDelta, opts = {}) {
  if (typeof baseDelta !== 'number' || baseDelta >= 0) {
    return { skipped: true, reason: 'invalid_delta' };
  }

  const { cooldownKey = null, cooldownSec = 86400, metadata = {} } = opts;

  // 1. 冷却
  if (cooldownKey) {
    const ok = await checkAndSetCooldown(cooldownKey, cooldownSec);
    if (!ok) return { skipped: true, reason: 'cooldown' };
  }

  // 2. 读 user
  const { data: user, error: readErr } = await supabase
    .from('users')
    .select('id, status, risk_score, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (readErr || !user) {
    return { skipped: true, reason: 'user_not_found' };
  }
  if (user.status === 'banned') {
    return { skipped: true, reason: 'banned' };
  }
  if ((user.risk_score || 0) <= 0) {
    return { skipped: true, reason: 'no_score_to_reduce' };
  }

  // 3. 新号保护期 × 30%
  const protectionDays = parseInt(
    await getSystemConfig('new_account_protection_days', 7),
    10
  ) || 7;
  const regDays = (Date.now() - new Date(user.created_at).getTime()) / DAY_MS;
  let effective = baseDelta;
  if (regDays < protectionDays) {
    // Math.ceil 对负数向 0 靠：ceil(-0.9)=0, ceil(-1.5)=-1
    effective = Math.ceil(baseDelta * 0.3);
  }
  if (effective >= 0) {
    return { skipped: true, reason: 'rounded_to_zero', baseDelta, effective };
  }

  // 4. 通过 recordEvent 写 risk_events + 更新 users.risk_score + 闭环
  const eventResult = await recordEvent({
    userId,
    ruleCode: decayType.toUpperCase(),
    scoreDelta: effective,
    reason: 'reward',
    evidence: { ...metadata, base_delta: baseDelta },
  });

  // 5. 额外写 decay_log（无论 enforce / observe 都写，便于追溯）
  try {
    const newScore =
      eventResult && typeof eventResult.newScore === 'number'
        ? eventResult.newScore
        : Math.max(0, user.risk_score + effective);
    await supabase.from('risk_score_decay_log').insert({
      user_id: userId,
      before_score: user.risk_score,
      after_score: newScore,
      decay_type: decayType,
      metadata: { ...metadata, cooldown_key: cooldownKey, base_delta: baseDelta, effective_delta: effective },
    });
  } catch (err) {
    console.warn('[reward] decay_log insert failed:', err && err.message);
  }

  return {
    applied: true,
    scoreDelta: effective,
    baseDelta,
    newScore: eventResult && eventResult.newScore,
    mode: eventResult && eventResult.mode,
  };
}

// --- 4 个触发点 helpers ---

async function rewardPostLikedByStranger({ postId, authorId, likerId }) {
  if (!authorId || !likerId || authorId === likerId) {
    return { skipped: true, reason: 'self' };
  }
  if (await isInSameCluster(authorId, likerId)) {
    return { skipped: true, reason: 'same_cluster' };
  }
  return tryAddReward(authorId, 'reward_post_liked_by_stranger', -3, {
    cooldownKey: `reward:post:${postId}`,
    cooldownSec: 365 * 86400,
    metadata: { post_id: postId, liker_id: likerId },
  });
}

async function rewardCommentReplied({ authorId, replierId, postId, commentId }) {
  if (!authorId || !replierId || authorId === replierId) {
    return { skipped: true, reason: 'self' };
  }
  if (await isInSameCluster(authorId, replierId)) {
    return { skipped: true, reason: 'same_cluster' };
  }
  const today = new Date().toISOString().slice(0, 10);
  return tryAddReward(authorId, 'reward_comment_replied', -2, {
    cooldownKey: `reward:reply:${authorId}:${today}`,
    cooldownSec: 86400,
    metadata: { post_id: postId, comment_id: commentId, replier_id: replierId },
  });
}

async function rewardFriendAccepted({ requesterId, addresseeId }) {
  if (!requesterId || !addresseeId || requesterId === addresseeId) {
    return { skipped: true, reason: 'self' };
  }
  if (await isInSameCluster(requesterId, addresseeId)) {
    return { skipped: true, reason: 'same_cluster' };
  }
  const today = new Date().toISOString().slice(0, 10);
  return tryAddReward(requesterId, 'reward_friend_accepted', -3, {
    cooldownKey: `reward:friend:${requesterId}:${today}`,
    cooldownSec: 86400,
    metadata: { addressee_id: addresseeId },
  });
}

async function rewardWeeklyActiveClean(userId) {
  return tryAddReward(userId, 'reward_weekly_active', -5, {
    cooldownKey: `reward:weekly:${userId}`,
    cooldownSec: 7 * 86400,
    metadata: {},
  });
}

module.exports = {
  tryAddReward,
  rewardPostLikedByStranger,
  rewardCommentReplied,
  rewardFriendAccepted,
  rewardWeeklyActiveClean,
};
