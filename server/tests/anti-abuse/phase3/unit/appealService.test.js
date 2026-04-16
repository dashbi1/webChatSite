// appealService 单元测试
//   - feature flag（appeals_enabled=false → COMING_SOON 503）
//   - 7 天 3 次限流
//   - 理由过短 / 缺邮箱
//   - resolve 通过时 -30 分 + 解封

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function setup({
  appealsEnabled = true,
  existingCountIn7d = 0,
  insertResult = { data: { id: 'a1' }, error: null },
  resolveAppeal = { data: { id: 'a1', status: 'approved' }, error: null },
  appealRow = null,
  userRow = null,
} = {}) {
  const insertCalls = [];
  const updateCalls = [];

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: jest.fn(async (key) => {
      if (key === 'appeals_enabled') return appealsEnabled;
      return null;
    }),
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'appeals') {
        return {
          // 限流查询 / /my 列表都走 select
          select: (_fields, opts) => {
            const countMode = opts && opts.count === 'exact' && opts.head;
            const builder = {
              eq: () => builder,
              gte: () => builder,
              maybeSingle: async () => ({ data: appealRow, error: null }),
              range: () => builder,
              order: () => builder,
              then: (resolve) =>
                resolve(
                  countMode
                    ? { count: existingCountIn7d, error: null }
                    : { data: [], error: null }
                ),
            };
            return builder;
          },
          insert: (row) => {
            insertCalls.push({ table, row });
            return {
              select: () => ({
                single: async () => insertResult,
              }),
            };
          },
          update: (patch) => ({
            eq: () => {
              updateCalls.push({ table, patch });
              return {
                select: () => ({
                  single: async () => resolveAppeal,
                }),
              };
            },
          }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: userRow, error: null }),
            }),
          }),
          update: (patch) => ({
            eq: () => {
              updateCalls.push({ table, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'risk_events') {
        return {
          insert: (row) => {
            insertCalls.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
  }));

  const svc = require('../../../../src/services/appeals/appealService');
  return { svc, insertCalls, updateCalls };
}

describe('submitAppeal', () => {
  test('appeals_enabled=false → COMING_SOON 503', async () => {
    const { svc } = setup({ appealsEnabled: false });
    await expect(
      svc.submitAppeal('u1', { contact_email: 'a@b.com', reason: '我被误伤了请帮忙' })
    ).rejects.toMatchObject({ code: 'COMING_SOON', status: 503 });
  });

  test('理由 < 10 字 → REASON_TOO_SHORT 400', async () => {
    const { svc } = setup({ appealsEnabled: true });
    await expect(
      svc.submitAppeal('u1', { contact_email: 'a@b.com', reason: '短' })
    ).rejects.toMatchObject({ code: 'REASON_TOO_SHORT', status: 400 });
  });

  test('缺邮箱 → EMAIL_REQUIRED 400', async () => {
    const { svc } = setup({ appealsEnabled: true });
    await expect(
      svc.submitAppeal('u1', { reason: '我被误伤了请帮忙处理' })
    ).rejects.toMatchObject({ code: 'EMAIL_REQUIRED', status: 400 });
  });

  test('7 天内已 3 次 → RATE_LIMITED 429', async () => {
    const { svc } = setup({ appealsEnabled: true, existingCountIn7d: 3 });
    await expect(
      svc.submitAppeal('u1', { contact_email: 'a@b.com', reason: '我被误伤了请帮忙处理' })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  test('正常提交', async () => {
    const { svc, insertCalls } = setup({ appealsEnabled: true, existingCountIn7d: 0 });
    const res = await svc.submitAppeal('u1', {
      contact_email: 'a@b.com',
      reason: '我被误伤了请帮忙处理',
      evidence_urls: ['http://x.com/1.png'],
    });
    expect(res).toEqual({ id: 'a1' });
    expect(insertCalls[0].row.user_id).toBe('u1');
    expect(insertCalls[0].row.reason).toBe('我被误伤了请帮忙处理');
    expect(insertCalls[0].row.evidence_urls).toEqual(['http://x.com/1.png']);
  });
});

describe('resolveAppeal', () => {
  test('approved 时 -30 风险分 + 解封', async () => {
    const pendingAppeal = { id: 'a1', user_id: 'u1', status: 'pending' };
    const targetUser = { id: 'u1', risk_score: 80, status: 'banned' };
    const { svc, updateCalls, insertCalls } = setup({
      appealsEnabled: true,
      appealRow: pendingAppeal,
      userRow: targetUser,
      resolveAppeal: {
        data: { id: 'a1', status: 'approved', user_id: 'u1' },
        error: null,
      },
    });
    const result = await svc.resolveAppeal('a1', 'admin1', 'approved', '证据充分');
    expect(result.status).toBe('approved');
    // 应该有 2 条 update: appeals 和 users
    const userUpdate = updateCalls.find((c) => c.table === 'users');
    expect(userUpdate).toBeDefined();
    expect(userUpdate.patch.risk_score).toBe(50); // 80 - 30
    expect(userUpdate.patch.status).toBe('active');
    expect(userUpdate.patch.restricted_until).toBe(null);
    // 应该写了一条 risk_events
    const evt = insertCalls.find((c) => c.table === 'risk_events');
    expect(evt).toBeDefined();
    expect(evt.row.rule_code).toBe('APPEAL_APPROVE');
    expect(evt.row.score_delta).toBe(-30);
  });

  test('rejected 时只改 appeal 状态', async () => {
    const pendingAppeal = { id: 'a1', user_id: 'u1', status: 'pending' };
    const { svc, updateCalls, insertCalls } = setup({
      appealsEnabled: true,
      appealRow: pendingAppeal,
      userRow: { id: 'u1', risk_score: 50 },
      resolveAppeal: {
        data: { id: 'a1', status: 'rejected', user_id: 'u1' },
        error: null,
      },
    });
    await svc.resolveAppeal('a1', 'admin1', 'rejected', '理由不成立');
    // users 表不应该被更新
    const userUpdate = updateCalls.find((c) => c.table === 'users');
    expect(userUpdate).toBeUndefined();
    // risk_events 不应该被写
    const evt = insertCalls.find((c) => c.table === 'risk_events');
    expect(evt).toBeUndefined();
  });

  test('无效 status 抛错', async () => {
    const { svc } = setup();
    await expect(svc.resolveAppeal('a1', 'admin1', 'xxx')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
  });
});
