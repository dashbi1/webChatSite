// /api/admin/clusters 路由集成测试

const request = require('supertest');

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function buildApp({ fingerprintData = [], ipData = [] } = {}) {
  jest.doMock('../../../../src/middleware/auth', () => ({
    authMiddleware: (req, _res, next) => {
      req.user = { id: 'admin1', role: 'admin' };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    rpc: async (name) => {
      if (name === 'list_fingerprint_clusters') {
        return { data: fingerprintData, error: null };
      }
      if (name === 'list_ip_cidr24_clusters') {
        return { data: ipData, error: null };
      }
      return { data: [], error: null };
    },
  }));

  const express = require('express');
  const app = express();
  app.use('/api/admin/clusters', require('../../../../src/routes/admin/clusters'));
  return app;
}

describe('GET /api/admin/clusters', () => {
  test('type=fingerprint 调 list_fingerprint_clusters RPC', async () => {
    const app = buildApp({
      fingerprintData: [
        {
          fingerprint_id: 'fp-1',
          fingerprint_hash: 'h1'.repeat(16),
          platform: 'web',
          account_count: 5,
          account_ids: ['u1', 'u2', 'u3', 'u4', 'u5'],
          last_seen_at: '2026-04-16T00:00:00Z',
        },
      ],
    });
    const res = await request(app).get('/api/admin/clusters?type=fingerprint&min=3');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].account_count).toBe(5);
    expect(res.body.meta.type).toBe('fingerprint');
  });

  test('type=ip_cidr24 调 list_ip_cidr24_clusters RPC', async () => {
    const app = buildApp({
      ipData: [
        {
          ip_cidr_24: '192.168.1.0/24',
          account_count: 7,
          account_ids: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
          ip_count: 3,
          last_seen_at: '2026-04-16T00:00:00Z',
        },
      ],
    });
    const res = await request(app).get('/api/admin/clusters?type=ip_cidr24');
    expect(res.status).toBe(200);
    expect(res.body.data[0].account_count).toBe(7);
    expect(res.body.meta.type).toBe('ip_cidr24');
  });

  test('非法 type → 400', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/clusters?type=bad');
    expect(res.status).toBe(400);
  });

  test('min / limit 参数被 clamp 到合理范围', async () => {
    const app = buildApp({ fingerprintData: [] });
    // min 太小应 clamp 到 2，limit 太大应 clamp 到 200
    const res = await request(app).get('/api/admin/clusters?type=fingerprint&min=0&limit=99999');
    expect(res.status).toBe(200);
    expect(res.body.meta.min).toBe(2);
    expect(res.body.meta.limit).toBe(200);
  });
});
