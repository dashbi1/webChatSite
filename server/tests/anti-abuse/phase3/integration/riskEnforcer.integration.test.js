// riskEnforcer 中间件集成测试：挂在一个 mini express app 的路由上，
// 按 users 状态 / mode 组合验证 403/200。

const express = require('express');
const request = require('supertest');

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function buildApp({ userRow, mode = 'enforce', authUser = { id: 'u1' } }) {
  jest.doMock('../../../../src/middleware/auth', () => ({
    authMiddleware: (req, _res, next) => {
      req.user = { ...authUser };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
  }));

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: async (key) => {
      if (key === 'risk_enforcement_mode') return mode;
      return null;
    },
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: userRow, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  }));

  const { authMiddleware } = require('../../../../src/middleware/auth');
  const { riskEnforcer } = require('../../../../src/middleware/riskEnforcer');

  const app = express();
  app.use(express.json());
  app.post('/test', authMiddleware, riskEnforcer(), (req, res) => {
    res.json({
      success: true,
      isFrozen: req.user.isFrozen,
      isShadowBanned: req.user.isShadowBanned,
      mode: req.user.enforceMode,
    });
  });
  return app;
}

describe('riskEnforcer middleware', () => {
  test('active 用户：200 + 无冻结', async () => {
    const app = buildApp({
      userRow: {
        id: 'u1',
        status: 'active',
        risk_score: 10,
        restricted_until: null,
        is_shadow_banned: false,
        shadow_ban_until: null,
      },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.isFrozen).toBe(false);
    expect(res.body.isShadowBanned).toBe(false);
  });

  test('banned 用户：403 BANNED', async () => {
    const app = buildApp({
      userRow: {
        id: 'u1',
        status: 'banned',
        risk_score: 100,
      },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BANNED');
  });

  test('frozen（restricted_until 未来）enforce 模式：403 UNDER_REVIEW', async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const app = buildApp({
      userRow: {
        id: 'u1',
        status: 'active',
        risk_score: 75,
        restricted_until: future,
        is_shadow_banned: false,
        shadow_ban_until: null,
      },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UNDER_REVIEW');
  });

  test('frozen 但 observe 模式：放行，isFrozen 为 false（observe 下不触发）', async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const app = buildApp({
      mode: 'observe',
      userRow: {
        id: 'u1',
        status: 'active',
        risk_score: 75,
        restricted_until: future,
        is_shadow_banned: false,
        shadow_ban_until: null,
      },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.isFrozen).toBe(false);
    expect(res.body.mode).toBe('observe');
  });

  test('restricted_until 过期：不视为 frozen', async () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    const app = buildApp({
      userRow: {
        id: 'u1',
        status: 'active',
        risk_score: 30,
        restricted_until: past,
        is_shadow_banned: false,
        shadow_ban_until: null,
      },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.isFrozen).toBe(false);
  });

  test('shadow 未过期 enforce 模式：放行（shadow 不拦截请求） + isShadowBanned=true', async () => {
    const future = new Date(Date.now() + 86400 * 1000).toISOString();
    const app = buildApp({
      userRow: {
        id: 'u1',
        status: 'active',
        risk_score: 50,
        restricted_until: null,
        is_shadow_banned: true,
        shadow_ban_until: future,
      },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.isShadowBanned).toBe(true);
  });

  test('users 记录不存在：401', async () => {
    const app = buildApp({ userRow: null });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(401);
  });
});
