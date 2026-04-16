// dedupDecay 单元测试：computeAppliedDelta 的 none / once / decay 逻辑

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function setup({ hits = 0, error = null } = {}) {
  // capture 传给 select / eq / gte 的参数以便断言
  const calls = { selectOpts: null, eqCalls: [], gteCalls: [] };

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (_table) => ({
      select: (_fields, opts) => {
        calls.selectOpts = opts;
        const builder = {
          eq: (col, val) => {
            calls.eqCalls.push({ col, val });
            return builder;
          },
          gte: (col, val) => {
            calls.gteCalls.push({ col, val });
            return builder;
          },
          then: (resolve) =>
            resolve(error ? { count: 0, error } : { count: hits, error: null }),
        };
        return builder;
      },
    }),
  }));

  const mod = require('../../../../src/services/riskEngine/dedupDecay');
  return { ...mod, calls };
}

describe('computeAppliedDelta — none mode', () => {
  test('返回 rule.score，不查 DB', async () => {
    const { computeAppliedDelta, calls } = setup({ hits: 5 });
    const delta = await computeAppliedDelta('u1', { code: 'X', score: 25, params: {} });
    expect(delta).toBe(25);
    // params 没有 dedup_mode → none → 不应查 DB
    expect(calls.eqCalls.length).toBe(0);
  });

  test('显式 dedup_mode=none 同上', async () => {
    const { computeAppliedDelta } = setup({ hits: 999 });
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 10,
      params: { dedup_mode: 'none' },
    });
    expect(delta).toBe(10);
  });
});

describe('computeAppliedDelta — once mode', () => {
  test('无命中 → 返回 rule.score', async () => {
    const { computeAppliedDelta } = setup({ hits: 0 });
    const delta = await computeAppliedDelta('u1', {
      code: 'ASN_DATACENTER',
      score: 25,
      params: { dedup_mode: 'once', dedup_window_hours: 720 },
    });
    expect(delta).toBe(25);
  });

  test('已命中 1 次 → 返回 0（跳过）', async () => {
    const { computeAppliedDelta } = setup({ hits: 1 });
    const delta = await computeAppliedDelta('u1', {
      code: 'ASN_DATACENTER',
      score: 25,
      params: { dedup_mode: 'once', dedup_window_hours: 720 },
    });
    expect(delta).toBe(0);
  });

  test('已命中 N 次 → 返回 0', async () => {
    const { computeAppliedDelta } = setup({ hits: 5 });
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 10,
      params: { dedup_mode: 'once', dedup_window_hours: 24 },
    });
    expect(delta).toBe(0);
  });

  test('dedup_window_hours=null → 永久窗口（不带 created_at 过滤）', async () => {
    const { computeAppliedDelta, calls } = setup({ hits: 0 });
    await computeAppliedDelta('u1', {
      code: 'COLD_EMAIL_DOMAIN',
      score: 10,
      params: { dedup_mode: 'once', dedup_window_hours: null },
    });
    // 不应有 created_at 的 gte 过滤
    expect(calls.gteCalls.find((c) => c.col === 'created_at')).toBeUndefined();
  });

  test('dedup_window_hours=24 → 带 created_at >= since 过滤', async () => {
    const { computeAppliedDelta, calls } = setup({ hits: 0 });
    await computeAppliedDelta('u1', {
      code: 'DEVICE_MULTI_ACCOUNT',
      score: 25,
      params: { dedup_mode: 'once', dedup_window_hours: 24 },
    });
    const gteOnCreated = calls.gteCalls.find((c) => c.col === 'created_at');
    expect(gteOnCreated).toBeDefined();
    // since 应该是 24h 前
    const sinceMs = new Date(gteOnCreated.val).getTime();
    const diffHours = (Date.now() - sinceMs) / 3600 / 1000;
    expect(diffHours).toBeGreaterThan(23.9);
    expect(diffHours).toBeLessThan(24.1);
  });
});

describe('computeAppliedDelta — decay mode', () => {
  test('无命中 → 返回 base', async () => {
    const { computeAppliedDelta } = setup({ hits: 0 });
    const delta = await computeAppliedDelta('u1', {
      code: 'SIMHASH_SIMILAR',
      score: 12,
      params: { dedup_mode: 'decay', dedup_window_hours: 24, decay_factor: 0.5 },
    });
    expect(delta).toBe(12);
  });

  test('2 次命中 → base × 0.5^2 = 3', async () => {
    const { computeAppliedDelta } = setup({ hits: 2 });
    const delta = await computeAppliedDelta('u1', {
      code: 'SIMHASH_SIMILAR',
      score: 12,
      params: { dedup_mode: 'decay', dedup_window_hours: 24, decay_factor: 0.5 },
    });
    expect(delta).toBe(3);
  });

  test('衰减到 < 1 时保底 1', async () => {
    const { computeAppliedDelta } = setup({ hits: 10 });
    // 1 × 0.5^10 ≈ 0.001 → 保底 1
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 1,
      params: { dedup_mode: 'decay', dedup_window_hours: 1, decay_factor: 0.5 },
    });
    expect(delta).toBe(1);
  });

  test('非对称 factor 0.7', async () => {
    const { computeAppliedDelta } = setup({ hits: 3 });
    // 10 × 0.7^3 = 10 × 0.343 = 3.43 → round → 3
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 10,
      params: { dedup_mode: 'decay', dedup_window_hours: 24, decay_factor: 0.7 },
    });
    expect(delta).toBe(3);
  });

  test('decay_factor 缺省默认 0.5', async () => {
    const { computeAppliedDelta } = setup({ hits: 2 });
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 20,
      params: { dedup_mode: 'decay', dedup_window_hours: 24 }, // 无 decay_factor
    });
    // 20 × 0.5^2 = 5
    expect(delta).toBe(5);
  });

  test('decay_factor=0 被 clamp，不会永久返回 0', async () => {
    const { computeAppliedDelta } = setup({ hits: 3 });
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 100,
      params: { dedup_mode: 'decay', dedup_window_hours: 24, decay_factor: 0 },
    });
    // factor 被 clamp 到 0.01 → 100 × 0.01^3 ≈ 0.0001 → 保底 1
    expect(delta).toBe(1);
  });
});

describe('computeAppliedDelta — 错误处理', () => {
  test('DB 查询失败时默认放行（按 0 hits 处理）', async () => {
    const { computeAppliedDelta } = setup({ error: { message: 'db down' } });
    const delta = await computeAppliedDelta('u1', {
      code: 'X',
      score: 10,
      params: { dedup_mode: 'once', dedup_window_hours: 24 },
    });
    // 查询失败 → hits=0 → once 放行返回 10
    expect(delta).toBe(10);
  });

  test('rule 为空 / 无 score → 返回 0', async () => {
    const { computeAppliedDelta } = setup();
    expect(await computeAppliedDelta('u1', null)).toBe(0);
    expect(await computeAppliedDelta('u1', { code: 'X' })).toBe(0);
  });

  test('userId 为空 → 返回 0', async () => {
    const { computeAppliedDelta } = setup();
    expect(await computeAppliedDelta(null, { code: 'X', score: 10 })).toBe(0);
  });
});
