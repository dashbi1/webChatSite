// Phase 3 风控执行中间件
//
// 职责：
//   1. 查 users 表拉最新风控字段（auth 中间件只查 status/role，risk_* 字段需单独查）
//   2. 计算 enforce 模式下的 isFrozen / isShadowBanned，挂到 req.user
//   3. 若 options.blockFrozen=true（默认）且命中冻结 → 返回 403 UNDER_REVIEW
//
// Observe 模式下：不拦截、也不把 isFrozen/isShadowBanned 置 true（即路由层看到的"生效"状态为空）
// 这样 posts.js 等路由层可以无脑 "if (req.user.isShadowBanned) shadow=true"。
//
// 使用：
//   router.post('/', authMiddleware, riskEnforcer(), handler)      // 默认 blockFrozen=true
//   router.get('/', authMiddleware, riskEnforcer({blockFrozen:false}), handler)  // 仅挂状态

const supabase = require('../config/supabase');
const { getSystemConfig } = require('../services/config/systemConfig');

function riskEnforcer(options = {}) {
  const { blockFrozen = true } = options;

  return async function riskEnforcerMw(req, res, next) {
    if (!req.user || !req.user.id) return next();

    let user;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, status, risk_score, restricted_until, is_shadow_banned, shadow_ban_until')
        .eq('id', req.user.id)
        .single();
      if (error || !data) {
        return res.status(401).json({ success: false, error: '用户不存在' });
      }
      user = data;
    } catch (e) {
      console.warn('[riskEnforcer] users read failed:', e && e.message);
      return next(); // 读失败不阻塞业务
    }

    // 双保险：auth 中间件已拦过 banned，但保险起见
    if (user.status === 'banned') {
      return res.status(403).json({
        success: false,
        code: 'BANNED',
        error: '账号已被封禁',
      });
    }

    const mode = (await getSystemConfig('risk_enforcement_mode', 'enforce')) || 'enforce';
    const now = Date.now();

    const restrictedActive =
      user.restricted_until && new Date(user.restricted_until).getTime() > now;
    const shadowActive =
      user.is_shadow_banned &&
      user.shadow_ban_until &&
      new Date(user.shadow_ban_until).getTime() > now;

    // observe 模式下不把"生效"信号传下去，避免路由层误写 shadow_ban
    const isFrozen = mode === 'enforce' && !!restrictedActive;
    const isShadowBanned = mode === 'enforce' && !!shadowActive;

    req.user.riskScore = user.risk_score;
    req.user.restrictedUntil = user.restricted_until;
    req.user.shadowBanUntil = user.shadow_ban_until;
    req.user.isFrozen = isFrozen;
    req.user.isShadowBanned = isShadowBanned;
    req.user.enforceMode = mode;

    if (blockFrozen && isFrozen) {
      return res.status(403).json({
        success: false,
        code: 'UNDER_REVIEW',
        error: '账号审核中，暂时无法进行此操作',
      });
    }

    next();
  };
}

module.exports = { riskEnforcer };
