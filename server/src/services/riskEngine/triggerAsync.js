// 路由 fire-and-forget 触发风控评估的助手
// 用法：
//   triggerRiskEval(userId, 'post_create', req, { post: inserted });
// 内部自动 fetch 最新用户数据（保证 rules 能读到 created_at / risk_score 等）

const supabase = require('../../config/supabase');
const { evaluate } = require('./index');
const { getClientIp, getClientIpCidr24 } = require('../../utils/ip');

// 从 request 抽取 req.abuse（若 fingerprintRecorder middleware 没有运行过，这里补一份）
function ensureAbuse(req) {
  if (!req.abuse) {
    req.abuse = {
      ip: getClientIp(req),
      ipCidr24: getClientIpCidr24(req),
      fingerprintHash:
        (req.headers && req.headers['x-device-fingerprint']) || null,
    };
  }
  return req.abuse;
}

async function fetchFreshUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function triggerRiskEval(userId, action, req, context = {}) {
  // fire-and-forget；失败只打日志，绝不影响主业务
  (async () => {
    try {
      if (!userId) return;
      ensureAbuse(req);
      const user = await fetchFreshUser(userId);
      if (!user) return;
      await evaluate({ user, action, req, context });
    } catch (err) {
      console.error(
        `[riskEngine] async trigger ${action} error:`,
        err && err.message
      );
    }
  })();
}

module.exports = { triggerRiskEval, ensureAbuse, fetchFreshUser };
