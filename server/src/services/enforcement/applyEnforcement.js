// Phase 3 降权执行核心：根据 risk_score + observe/enforce 开关
// 计算目标状态并更新 users 表。由 scoreStore 异步触发 或 admin 手动调用。
//
// 四档（见 docs/anti-abuse/00-overview.md#C）：
//   < 40：normal
//   40-70：restricted（shadow ban 14 天）
//   70-85：frozen（restricted_until 7 天）
//   >= 85：banned（status='banned'）
//
// 【Phase 3 Fix Pack】白名单邮箱不再豁免自动封禁：
//   白名单定义是"注册时少加初始怀疑分（COLD_EMAIL_DOMAIN 规则不触发）"，
//   不是"永不封禁"。批量注册 / 机房 IP 等积累到 85+ 同样自动封。
//   额外处理：白名单被封时推送一行 account_clusters pending 供 admin 审计。
//
// observe 模式下：不修改 users 状态字段，只返回"如果 enforce 应达到的级别"。

const supabase = require('../../config/supabase');
const { isWhitelistedDomain } = require('../whitelist/emailDomains');
const { getSystemConfig } = require('../config/systemConfig');
const { createBanRecord } = require('./banRecord');

const RESTRICT_DAYS = 7;
const SHADOW_DAYS = 14;
const DAY_MS = 86400 * 1000;

function scoreToLevel(score) {
  if (score >= 85) return 'banned';
  if (score >= 70) return 'frozen';
  if (score >= 40) return 'restricted';
  return 'normal';
}

/**
 * @param {{ id, email, risk_score, status, restricted_until, is_shadow_banned, shadow_ban_until }} user
 * @param {{ reason?, operatorId? }} options
 * @returns {Promise<{ score, level, enforced, mode, whitelistShielded }>}
 */
async function applyEnforcement(user, options = {}) {
  const score = typeof user.risk_score === 'number' ? user.risk_score : 0;
  const level = scoreToLevel(score);
  const mode = (await getSystemConfig('risk_enforcement_mode', 'enforce')) || 'enforce';
  const isWhitelist = isWhitelistedDomain(user.email);

  // observe 模式：不改 DB，仅返回"如果 enforce 的话"
  if (mode === 'observe') {
    return { score, level, enforced: false, mode: 'observe', whitelistShielded: false };
  }

  // enforce 模式
  const now = Date.now();
  const updates = {
    is_shadow_banned: false,
    shadow_ban_until: null,
    restricted_until: null,
  };
  let newStatus = user.status;
  // whitelistShielded 保留返回但语义改：仅表示"封禁同时额外推送 admin pending"
  let whitelistShielded = false;

  if (level === 'banned') {
    // 无差别封禁（白名单不再豁免）
    newStatus = 'banned';
    try {
      await createBanRecord({
        targetType: 'user',
        targetId: user.id,
        banType: 'auto_score',
        reason: options.reason || `风险分 ${score} >= 85 自动封禁`,
        createdBy: options.operatorId || null,
      });
    } catch (e) {
      console.warn('[applyEnforcement] createBanRecord failed:', e && e.message);
    }
    // 白名单邮箱额外推送一条 account_clusters pending 给 admin 审计可见
    if (isWhitelist) {
      whitelistShielded = true;
      try {
        await supabase.from('account_clusters').insert({
          cluster_type: 'simhash_similar',
          member_ids: [user.id],
          suspicion_score: Math.min(score, 100),
          evidence: {
            reason: 'whitelist_email_autobanned_notice',
            email_domain: (user.email || '').split('@')[1] || '',
            score,
          },
          status: 'pending',
        });
      } catch (e) {
        console.warn('[applyEnforcement] whitelist cluster insert failed:', e && e.message);
      }
    }
  } else if (level === 'frozen') {
    updates.restricted_until = new Date(now + RESTRICT_DAYS * DAY_MS).toISOString();
  } else if (level === 'restricted') {
    updates.is_shadow_banned = true;
    updates.shadow_ban_until = new Date(now + SHADOW_DAYS * DAY_MS).toISOString();
  }
  // level === 'normal' 直接写默认空值 → 清理旧降权标记

  const patch = { ...updates };
  if (newStatus !== user.status) patch.status = newStatus;

  const { error } = await supabase.from('users').update(patch).eq('id', user.id);
  if (error) {
    console.warn('[applyEnforcement] users update failed:', error.message);
  }

  return {
    score,
    level,
    enforced: newStatus === 'banned',
    mode: 'enforce',
    whitelistShielded,
  };
}

module.exports = { applyEnforcement, scoreToLevel };
