// 测试策略：
//   - 默认 env 下 UPSTASH_REDIS_REST_URL 为占位值 → redis 为 noop → 不限流
//   - 直接测 checkLimit 和中间件；checkLimit 的 Redis 交互通过 jest.mock 替换

const originalEnv = { ...process.env };

function resetRedisSingleton() {
  jest.resetModules();
}

afterEach(() => {
  process.env = { ...originalEnv };
  resetRedisSingleton();
});

describe('checkLimit', () => {
  test('RATE_LIMIT_ENABLED=false 直接 allowed', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const { checkLimit } = require('../../../../src/middleware/rateLimit');
    const r = await checkLimit('any:key', 1, 60);
    expect(r.allowed).toBe(true);
    expect(r.skipped).toBe('disabled');
  });

  test('Redis noop 时（未配置）直接 allowed', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://tokyo-xxx.upstash.io'; // 占位
    const { checkLimit } = require('../../../../src/middleware/rateLimit');
    const r = await checkLimit('any:key', 1, 60);
    expect(r.allowed).toBe(true);
    expect(r.skipped).toBe('noop');
  });

  test('Redis 有效 + 计数未超限 → allowed=true', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';

    jest.doMock('@upstash/redis', () => ({
      Redis: class {
        constructor() {}
        async incr() { return 1; }
        async expire() { return 1; }
      },
    }));

    const { checkLimit } = require('../../../../src/middleware/rateLimit');
    const r = await checkLimit('k', 3, 60);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  test('Redis 计数超限 → allowed=false', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';

    jest.doMock('@upstash/redis', () => ({
      Redis: class {
        constructor() {}
        async incr() { return 5; }
        async expire() { return 1; }
      },
    }));

    const { checkLimit } = require('../../../../src/middleware/rateLimit');
    const r = await checkLimit('k', 3, 60);
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(5);
  });
});

describe('rateLimitSendCode middleware', () => {
  function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }

  test('未达上限 → next()', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';
    jest.doMock('@upstash/redis', () => ({
      Redis: class { async incr() { return 1; } async expire() {} },
    }));
    const { rateLimitSendCode } = require('../../../../src/middleware/rateLimit');
    const mw = rateLimitSendCode();
    const next = jest.fn();
    const res = makeRes();
    await mw(
      { headers: { 'x-real-ip': '1.1.1.1' }, body: { email: 'a@b.com' } },
      res,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('IP 超限 → 429', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';
    jest.doMock('@upstash/redis', () => ({
      Redis: class { async incr() { return 10; } async expire() {} },
    }));
    const { rateLimitSendCode } = require('../../../../src/middleware/rateLimit');
    const mw = rateLimitSendCode();
    const next = jest.fn();
    const res = makeRes();
    await mw(
      { headers: { 'x-real-ip': '1.1.1.1' }, body: { email: 'a@b.com' } },
      res,
      next
    );
    expect(res.statusCode).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });

  test('Redis 异常 → fail-open 放行', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';
    jest.doMock('@upstash/redis', () => ({
      Redis: class { async incr() { throw new Error('down'); } async expire() {} },
    }));
    const { rateLimitSendCode } = require('../../../../src/middleware/rateLimit');
    const mw = rateLimitSendCode();
    const next = jest.fn();
    const res = makeRes();
    await mw(
      { headers: { 'x-real-ip': '1.1.1.1' }, body: { email: 'a@b.com' } },
      res,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
