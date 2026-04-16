// /api/admin/bulk-ban 路由集成测试：preview + execute

const request = require('supertest');

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function buildApp({
  candidates = [],
  rpcResult = null,
  postsByKeyword = [],
} = {}) {
  const banCalls = [];

  jest.doMock('../../../../src/middleware/auth', () => ({
    authMiddleware: (req, _res, next) => {
      req.user = { id: 'admin1', role: 'admin' };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
  }));

  jest.doMock('../../../../src/services/enforcement/banRecord', () => ({
    createBanRecord: async (args) => {
      banCalls.push(args);
      return { id: 'ban-' + banCalls.length, ...args };
    },
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          select: () => {
            const b = {
              gte: () => b,
              neq: () => b,
              in: () => b,
              limit: () => Promise.resolve({ data: candidates, error: null }),
              then: (resolve) => resolve({ data: candidates, error: null }),
            };
            return b;
          },
        };
      }
      if (table === 'posts') {
        return {
          select: () => ({
            ilike: () => ({
              limit: () => Promise.resolve({ data: postsByKeyword, error: null }),
            }),
          }),
        };
      }
      return {};
    },
    rpc: async (name, params) => {
      if (name === 'users_same_ip_within_hours' || name === 'users_by_fingerprint_cluster') {
        return { data: rpcResult || candidates, error: null };
      }
      return { data: [], error: null };
    },
  }));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/bulk-ban', require('../../../../src/routes/admin/bulkBan'));
  return { app, banCalls };
}

describe('POST /api/admin/bulk-ban/preview', () => {
  test('mode=score_gt 返回候选', async () => {
    const { app } = buildApp({
      candidates: [
        { id: 'u1', email: 'a@x.com', risk_score: 80 },
        { id: 'u2', email: 'b@x.com', risk_score: 90 },
      ],
    });
    const res = await request(app)
      .post('/api/admin/bulk-ban/preview')
      .send({ mode: 'score_gt', params: { threshold: 70 } });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
  });

  test('mode=keyword 走 posts.ilike + users.in', async () => {
    const { app } = buildApp({
      postsByKeyword: [{ author_id: 'u1' }, { author_id: 'u2' }, { author_id: 'u1' }],
      candidates: [
        { id: 'u1', email: 'a@x.com', nickname: 'A' },
        { id: 'u2', email: 'b@x.com', nickname: 'B' },
      ],
    });
    const res = await request(app)
      .post('/api/admin/bulk-ban/preview')
      .send({ mode: 'keyword', params: { keyword: '垃圾广告' } });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
  });

  test('非法 mode → 400', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/admin/bulk-ban/preview')
      .send({ mode: 'xxx' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/bulk-ban/execute', () => {
  test('执行时逐条调 createBanRecord', async () => {
    const { app, banCalls } = buildApp({
      candidates: [
        { id: 'u1', email: 'a@x.com', risk_score: 80 },
        { id: 'u2', email: 'b@x.com', risk_score: 90 },
      ],
    });
    const res = await request(app)
      .post('/api/admin/bulk-ban/execute')
      .send({ mode: 'score_gt', params: { threshold: 70 }, reason: '清理高危账号' });
    expect(res.status).toBe(200);
    expect(res.body.banned_count).toBe(2);
    expect(banCalls.length).toBe(2);
    expect(banCalls[0].banType).toBe('bulk_score_gt');
    expect(banCalls[0].reason).toBe('清理高危账号');
    expect(banCalls[0].createdBy).toBe('admin1');
  });
});
