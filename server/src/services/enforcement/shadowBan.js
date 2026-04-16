// Phase 3 shadow ban 抽样工具
//
// shouldShadowPost(user, sampleRate):
//   - user.isShadowBanned !== true → false（不 shadow）
//   - 返回 Math.random() < sampleRate
//
// 抽样率由调用方（通常是路由）从 system_config.shadow_ban_sample_rate 读
// 默认 0.5（屏蔽一半内容）

/**
 * @param {{ isShadowBanned?: boolean } | null | undefined} user
 * @param {number} sampleRate 默认 0.5
 * @returns {boolean}
 */
function shouldShadowPost(user, sampleRate = 0.5) {
  if (!user || user.isShadowBanned !== true) return false;
  const rate = clamp01(sampleRate);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

function clamp01(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

module.exports = { shouldShadowPost };
