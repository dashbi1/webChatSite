// 集成测试：/api/admin/risk/* 路由
// 策略：用 supertest 挂载真实 express app，只 mock supabase 和 auth middleware

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

// 构造一个极简可链式 Supabase mock：所有方法默认返回 self，
// 让 `await builder` 直接解析为 terminalResult
function makeQueryBuilder(terminalResult) {
  const self = {};
  const chain = ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'in', 'or', 'limit'];
  chain.forEach((m) => {
    self[m] = jest.fn(() => self);
  });
  self.single = jest.fn(async () => terminalResult);
  self.maybeSingle = jest.fn(async () => terminalResult);
  self.then = (resolve) => resolve(terminalResult);
  return self;
}

function buildApp({
  rulesList = [],
  ruleBefore = undefined, // undefined = 不 override；null = "不存在"
  ruleAfter = null,
  ruleUpdateError = null,
  configRows = [],
  eventsList = [],
  auditList = [],
  statsEvents = [],
  authUser = { id: 'admin1', role: 'admin' },
}) {
  jest.doMock('../../../../src/middleware/auth', () => ({
    authMiddleware: (req, _res, next) => {
      req.user = authUser;
      next();
    },
    adminMiddleware: (req, res, next) => {
      if (req.user && req.user.role === 'admin') return next();
      return res.status(403).json({ success: false, error: 'forbidden' });
    },
  }));

  const insertCalls = [];
  const upsertCalls = [];

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'risk_rules') {
        return {
          select: () => {
            const b = makeQueryBuilder({ data: rulesList, error: null });
            if (ruleBefore !== undefined) {
              b.maybeSingle = async () => ({ data: ruleBefore, error: null });
            }
            return b;
          },
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () =>
                  ruleUpdateError
                    ? { data: null, error: ruleUpdateError }
                    : { data: ruleAfter, error: null },
              }),
            }),
          }),
        };
      }
      if (table === 'risk_rule_audit') {
        return {
          insert: (data) => {
            insertCalls.push({ table, data });
            return Promise.resolve({ data: null, error: null });
          },
          select: () => makeQueryBuilder({ data: auditList, error: null }),
        };
      }
      if (table === 'system_config') {
        return {
          select: () => makeQueryBuilder({ data: configRows, error: null }),
          upsert: (data) => {
            upsertCalls.push({ table, data });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'risk_events') {
        return {
          select: () =>
            makeQueryBuilder({
              data: eventsList.length ? eventsList : statsEvents,
              error: null,
            }),
        };
      }
      return {
        select: () => makeQueryBuilder({ data: [], error: null }),
      };
    },
    __insertCalls: insertCalls,
    __upsertCalls: upsertCalls,
  }));

  // 也 mock 一下 systemConfig 的缓存（避免 getSystemConfig 走真实 supabase）
  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: jest.fn(async (k, d) => d),
    setSystemConfig: jest.fn(async () => true),
    _clearCache: jest.fn(),
  }));

  // ruleCache 的 invalidate 也打 jest mock 避免真实 supabase 调用
  jest.doMock('../../../../src/services/riskEngine/ruleCache', () => ({
    getRules: jest.fn(async () => rulesList),
    getRule: jest.fn(async (c) => rulesList.find((r) => r.code === c) || null),
    invalidate: jest.fn(),
    _setForTests: jest.fn(),
  }));

  const express = require('express');
  const adminRisk = require('../../../../src/routes/adminRisk');
  const app = express();
  app.use(express.json());
  app.use('/admin/risk', adminRisk);
  return app;
}

const request = require('supertest');

describe('GET /admin/risk/rules', () => {
  test('返回规则列表', async () => {
    const app = buildApp({
      rulesList: [
        { code: 'A', enabled: true, score: 10, category: 'device' },
        { code: 'B', enabled: false, score: 20, category: 'network' },
      ],
    });
    const res = await request(app).get('/admin/risk/rules');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  test('非管理员 → 403', async () => {
    const app = buildApp({
      rulesList: [],
      authUser: { id: 'u1', role: 'user' },
    });
    const res = await request(app).get('/admin/risk/rules');
    expect(res.status).toBe(403);
  });
});

describe('PUT /admin/risk/rules/:code', () => {
  test('修改 score 从 10 → 30', async () => {
    const before = { code: 'R1', enabled: true, score: 10, category: 'device' };
    const after = { code: 'R1', enabled: true, score: 30, category: 'device' };
    const app = buildApp({ ruleBefore: before, ruleAfter: after });
    const res = await request(app)
      .put('/admin/risk/rules/R1')
      .send({ score: 30 });
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(30);
  });

  test('score 越界 → 400', async () => {
    const app = buildApp({
      ruleBefore: { code: 'R', enabled: true, score: 10 },
    });
    const res = await request(app)
      .put('/admin/risk/rules/R')
      .send({ score: 150 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0-100/);
  });

  test('不存在 → 404', async () => {
    const app = buildApp({ ruleBefore: null });
    const res = await request(app).put('/admin/risk/rules/NOPE').send({ score: 30 });
    expect(res.status).toBe(404);
  });

  test('无变更 → noop=true', async () => {
    const before = { code: 'R', enabled: true, score: 10 };
    const app = buildApp({ ruleBefore: before, ruleAfter: before });
    const res = await request(app).put('/admin/risk/rules/R').send({});
    expect(res.status).toBe(200);
    expect(res.body.noop).toBe(true);
  });
});

describe('PUT /admin/risk/config/:key', () => {
  test('不允许的 key → 400', async () => {
    const app = buildApp({});
    const res = await request(app)
      .put('/admin/risk/config/evil_key')
      .send({ value: 'anything' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/不允许/);
  });

  test('risk_enforcement_mode 非法值 → 400', async () => {
    const app = buildApp({});
    const res = await request(app)
      .put('/admin/risk/config/risk_enforcement_mode')
      .send({ value: 'wrong' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/enforce 或 observe/);
  });

  test('合法切换 observe → 200', async () => {
    const app = buildApp({});
    const res = await request(app)
      .put('/admin/risk/config/risk_enforcement_mode')
      .send({ value: 'observe' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('缺 value → 400', async () => {
    const app = buildApp({});
    const res = await request(app)
      .put('/admin/risk/config/risk_enforcement_mode')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/risk/events/stats', () => {
  test('按 rule_code + mode 汇总 + 按次数降序', async () => {
    const app = buildApp({
      statsEvents: [
        { rule_code: 'A', mode: 'enforce' },
        { rule_code: 'A', mode: 'enforce' },
        { rule_code: 'A', mode: 'observe' },
        { rule_code: 'B', mode: 'enforce' },
      ],
    });
    const res = await request(app).get('/admin/risk/events/stats?hours=24');
    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0].count).toBeGreaterThanOrEqual(rows[rows.length - 1].count);
    const aEnforce = rows.find((r) => r.rule_code === 'A' && r.mode === 'enforce');
    expect(aEnforce.count).toBe(2);
    expect(res.body.window_hours).toBe(24);
  });
});
