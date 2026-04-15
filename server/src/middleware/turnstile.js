// Cloudflare Turnstile 人机验证中间件
// 详见 docs/anti-abuse/04-phase1-infrastructure.md 第 4.3 节

const { getClientIp } = require('../utils/ip');

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function postJson(url, body, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Object} options
 * @param {Function} [options.fetchVerify] 注入 fetch（测试用）
 * @param {string}   [options.expectedAction] 可选：断言 CF 回返的 action 等于此值（防 token 重放到其他端点）
 */
function verifyTurnstileFactory(options = {}) {
  const fetchVerify = options.fetchVerify || postJson;
  const expectedAction = options.expectedAction || null;

  return async function verifyTurnstile(req, res, next) {
    if (process.env.TURNSTILE_ENABLED === 'false') {
      return next();
    }
    const token =
      (req.body && req.body.turnstile_token) ||
      req.headers['cf-turnstile-response'];
    if (!token) {
      return res
        .status(400)
        .json({ success: false, error: '缺少人机验证，请刷新页面重试' });
    }
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      return res
        .status(500)
        .json({ success: false, error: '服务未配置人机验证密钥' });
    }
    try {
      const data = await fetchVerify(TURNSTILE_VERIFY_URL, {
        secret,
        response: token,
        remoteip: getClientIp(req),
      });
      if (!data || !data.success) {
        return res
          .status(400)
          .json({ success: false, error: '人机验证失败，请重新校验' });
      }
      // 防重放：若要求了 expectedAction，必须匹配
      if (expectedAction && data.action && data.action !== expectedAction) {
        return res.status(400).json({
          success: false,
          error: '人机验证 action 不匹配，请刷新重试',
        });
      }
      req.turnstile = { success: true, action: data.action || null };
      return next();
    } catch (err) {
      console.error('[turnstile] verify error:', err && err.message);
      return res
        .status(503)
        .json({ success: false, error: '人机验证服务暂不可用，请稍后重试' });
    }
  };
}

// 默认实例（不校验 action）
const verifyTurnstile = verifyTurnstileFactory();

module.exports = { verifyTurnstile, verifyTurnstileFactory };
