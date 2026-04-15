// 集成测试：/api/auth/send-code 的中间件链是否按期望拒绝 / 放行
// 策略：
//   - 通过环境变量和 mock 隔离 Supabase / Resend 依赖
//   - 校验 HTTP 响应码和 body，不依赖真实数据库
//
// 所有需要重新 require app 的用例在 isolateModules 里跑

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function resetEnvAndMocks() {
  process.env = { ...originalEnv };
  jest.resetModules();
}

function mockBusinessDeps({
  existingUser = null,
  createCodeResult = '123456',
  sendMailResult = Promise.resolve(),
} = {}) {
  jest.doMock('../../../../src/services/emailService', () => ({
    sendVerificationEmail: jest.fn(() => sendMailResult),
  }));
  jest.doMock('../../../../src/services/verificationService', () => ({
    createCode: jest.fn(async () => createCodeResult),
    verifyCode: jest.fn(async () => ({ ok: true })),
  }));
  jest.doMock('../../../../src/config/supabase', () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: existingUser }),
        }),
      }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: 'u1', email: 'a@b.com' } }) }),
      }),
    }),
  }));
}

describe('POST /api/auth/send-code — middleware chain', () => {
  test('Turnstile 关闭 + 合法请求 → 200', async () => {
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'false';
    process.env.RATE_LIMIT_ENABLED = 'false';
    mockBusinessDeps();
    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'test@gmail.com', purpose: 'register' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('Turnstile 开启 + 缺 token → 400', async () => {
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'true';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    process.env.RATE_LIMIT_ENABLED = 'false';
    mockBusinessDeps();
    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'test@gmail.com', purpose: 'register' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/人机验证/);
  });

  test('一次性邮箱 → 400', async () => {
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'false';
    process.env.RATE_LIMIT_ENABLED = 'false';
    mockBusinessDeps();
    const loader = require('../../../../src/services/disposableEmails/loader');
    loader._setForTests(['mailinator.com', 'temp-mail.org']);
    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'spam@mailinator.com', purpose: 'register' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/常用邮箱/);
  });

  test('edu.cn 邮箱在黑名单里（反常情况）也能通过', async () => {
    // 验证白名单优先级高于一次性邮箱黑名单
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'false';
    process.env.RATE_LIMIT_ENABLED = 'false';
    mockBusinessDeps();
    const loader = require('../../../../src/services/disposableEmails/loader');
    loader._setForTests(['hit.edu.cn']); // 极端情况：edu 域也被误录入黑名单
    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'student@hit.edu.cn', purpose: 'register' });
    expect(res.status).toBe(200);
  });

  test('邮箱格式不正确 → 400', async () => {
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'false';
    process.env.RATE_LIMIT_ENABLED = 'false';
    mockBusinessDeps();
    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'not-an-email', purpose: 'register' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/邮箱格式/);
  });

  test('purpose 无效 → 400', async () => {
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'false';
    process.env.RATE_LIMIT_ENABLED = 'false';
    mockBusinessDeps();
    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'test@gmail.com', purpose: 'evil' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/purpose/);
  });
});

describe('POST /api/auth/send-code — rate limit integration', () => {
  test('启用 Redis 且 incr 返回 > 限额 → 429', async () => {
    resetEnvAndMocks();
    process.env.TURNSTILE_ENABLED = 'false';
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';

    jest.doMock('@upstash/redis', () => ({
      Redis: class {
        async incr() { return 99; }
        async expire() { return 1; }
      },
    }));
    mockBusinessDeps();

    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ email: 'test@gmail.com', purpose: 'register' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/频繁|已达上限/);
  });
});

describe('POST /api/auth/register — rate limit', () => {
  test('注册同 IP 超上限 → 429', async () => {
    resetEnvAndMocks();
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://real.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-token';

    jest.doMock('@upstash/redis', () => ({
      Redis: class {
        async incr() { return 10; }
        async expire() { return 1; }
      },
    }));
    mockBusinessDeps();

    const request = require('supertest');
    const app = require('../../../../src/app');
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@gmail.com',
        code: '123456',
        password: 'pwd12345',
        nickname: 'x',
      });
    expect(res.status).toBe(429);
  });
});
