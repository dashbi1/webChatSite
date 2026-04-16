// /api/appeals 路由集成测试：覆盖 COMING_SOON / 限流 / 成功 / /my 列表

const request = require('supertest');

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function buildApp({
  appealsEnabled = true,
  countInWindow = 0,
  insertError = null,
  myList = [],
}) {
  jest.doMock('../../../../src/middleware/auth', () => ({
    authMiddleware: (req, _res, next) => {
      req.user = { id: 'u1' };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
  }));

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: async (key) => {
      if (key === 'appeals_enabled') return appealsEnabled;
      return null;
    },
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'appeals') {
        return {
          select: (_fields, opts) => {
            if (opts && opts.count === 'exact' && opts.head) {
              // 限流 head count
              const p = {
                eq: () => p,
                gte: () => Promise.resolve({ count: countInWindow, error: null }),
              };
              return p;
            }
            // /my 列表查询
            return {
              eq: () => ({
                order: () => Promise.resolve({ data: myList, error: null }),
              }),
            };
          },
          insert: (row) => ({
            select: () => ({
              single: async () => ({
                data: insertError ? null : { id: 'a1', ...row },
                error: insertError,
              }),
            }),
          }),
        };
      }
      return {};
    },
  }));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/appeals', require('../../../../src/routes/appeals'));
  return app;
}

describe('POST /api/appeals', () => {
  test('appeals_enabled=false → 503 COMING_SOON', async () => {
    const app = buildApp({ appealsEnabled: false });
    const res = await request(app)
      .post('/api/appeals')
      .send({ contact_email: 'a@b.com', reason: '我被误伤了请帮忙处理' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('COMING_SOON');
  });

  test('理由 < 10 字 → 400', async () => {
    const app = buildApp({ appealsEnabled: true });
    const res = await request(app)
      .post('/api/appeals')
      .send({ contact_email: 'a@b.com', reason: '短' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REASON_TOO_SHORT');
  });

  test('7 天内 >= 3 次 → 429 RATE_LIMITED', async () => {
    const app = buildApp({ appealsEnabled: true, countInWindow: 3 });
    const res = await request(app)
      .post('/api/appeals')
      .send({ contact_email: 'a@b.com', reason: '我被误伤了请帮忙处理' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  test('正常提交 → 200', async () => {
    const app = buildApp({ appealsEnabled: true, countInWindow: 0 });
    const res = await request(app)
      .post('/api/appeals')
      .send({ contact_email: 'a@b.com', reason: '我被误伤了请帮忙处理' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user_id).toBe('u1');
  });
});

describe('GET /api/appeals/my', () => {
  test('返回列表', async () => {
    const myList = [
      { id: 'a1', user_id: 'u1', status: 'pending', reason: '...', created_at: '2026-01-01' },
    ];
    const app = buildApp({ myList });
    const res = await request(app).get('/api/appeals/my');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(myList);
  });

  test('feature flag 关闭也能查（不走 submit 路径）', async () => {
    const app = buildApp({ appealsEnabled: false, myList: [] });
    const res = await request(app).get('/api/appeals/my');
    expect(res.status).toBe(200);
  });
});
