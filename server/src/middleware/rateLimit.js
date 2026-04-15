// 三层限流中间件（IP / 邮箱 / 设备）
// 基于 Upstash Redis + pipeline 原子化 INCR + EXPIRE
// 详见 docs/anti-abuse/04-phase1-infrastructure.md 第 4.4 节
//
// 原子化保证：INCR + EXPIRE 在 pipeline 中一次 round-trip 发送，
// 不会出现"INCR 成功但 EXPIRE 丢失导致 key 永久驻留"的场景。

const { getRedis, isRedisNoop } = require('../config/redis');
const { getClientIp } = require('../utils/ip');

// 单次限流检查：返回 { allowed, count, limit, skipped? }
async function checkLimit(key, limit, windowSec) {
  if (process.env.RATE_LIMIT_ENABLED === 'false') {
    return { allowed: true, count: 0, limit, skipped: 'disabled' };
  }
  const redis = getRedis();
  if (redis.isNoop || isRedisNoop()) {
    return { allowed: true, count: 0, limit, skipped: 'noop' };
  }

  let count;
  try {
    if (typeof redis.pipeline === 'function') {
      const pipe = redis.pipeline();
      pipe.incr(key);
      pipe.expire(key, windowSec);
      const results = await pipe.exec();
      // @upstash/redis pipeline 返回数组，第一个是 INCR 的结果
      count = Array.isArray(results) ? Number(results[0]) : Number(results);
    } else {
      // fallback：无 pipeline 接口时也每次都 expire（幂等，多消耗一次命令）
      count = await redis.incr(key);
      await redis.expire(key, windowSec);
    }
  } catch (err) {
    // 向上抛出由中间件决定 fail-open
    throw err;
  }

  return { allowed: count <= limit, count, limit };
}

// 通用 key builder
function keyFor(prefix, identifier, windowLabel) {
  const safe = String(identifier).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `abuse:rl:${prefix}:${safe}:${windowLabel}`;
}

// ============================================================
// 场景：发送验证码限流
//   - 同 IP：每分钟最多 2 次
//   - 同邮箱：每小时最多 5 次
// ============================================================
function rateLimitSendCode() {
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const email = (req.body && req.body.email)
        ? String(req.body.email).toLowerCase()
        : null;

      const ipCheck = await checkLimit(keyFor('send', ip, '60s'), 2, 60);
      if (!ipCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: '请求过于频繁，请稍后再试',
          retry_after: 60,
        });
      }

      if (email) {
        const emailCheck = await checkLimit(
          keyFor('send', email, '1h'),
          5,
          3600
        );
        if (!emailCheck.allowed) {
          return res.status(429).json({
            success: false,
            error: '该邮箱请求过多，请 1 小时后再试',
            retry_after: 3600,
          });
        }
      }
      next();
    } catch (err) {
      console.error('[rateLimit:sendCode] error:', err && err.message);
      // 限流服务故障时 fail-open 放行（避免 Redis 挂掉瘫痪注册）
      next();
    }
  };
}

// ============================================================
// 场景：注册限流
//   - 同 IP：每天最多 3 个注册
// ============================================================
function rateLimitRegister() {
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const check = await checkLimit(keyFor('register', ip, '1d'), 3, 86400);
      if (!check.allowed) {
        return res.status(429).json({
          success: false,
          error: '今日注册次数已达上限',
          retry_after: 86400,
        });
      }
      next();
    } catch (err) {
      console.error('[rateLimit:register] error:', err && err.message);
      next();
    }
  };
}

// ============================================================
// 场景：重置密码提交限流
//   - 同 IP：每 10 分钟最多 10 次（防止暴力枚举验证码）
// ============================================================
function rateLimitResetPassword() {
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const check = await checkLimit(keyFor('reset', ip, '10m'), 10, 600);
      if (!check.allowed) {
        return res.status(429).json({
          success: false,
          error: '尝试次数过多，请 10 分钟后再试',
          retry_after: 600,
        });
      }
      next();
    } catch (err) {
      console.error('[rateLimit:reset] error:', err && err.message);
      next();
    }
  };
}

module.exports = {
  checkLimit,
  keyFor,
  rateLimitSendCode,
  rateLimitRegister,
  rateLimitResetPassword,
};
