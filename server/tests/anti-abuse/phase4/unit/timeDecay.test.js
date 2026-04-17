// Phase 4: timeDecay 单元测试

afterEach(() => jest.resetModules());

function setup({ users = [], recordEventResult = { recorded: true } } = {}) {
  const calls = { recorded: [], decayLogInserts: [] };

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: jest.fn(async (key, def) => {
      if (key === 'score_decay_factor') return 0.9;
      if (key === 'new_account_protection_days') return 7;
      return def;
    }),
  }));

  jest.doMock('../../../../src/services/riskEngine/scoreStore', () => ({
    recordEvent: jest.fn(async (args) => {
      calls.recorded.push(args);
      return recordEventResult;
    }),
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          select: () => ({
            gt: () => ({
              neq: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: users, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'risk_score_decay_log') {
        return {
          insert: (row) => {
            calls.decayLogInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
  }));

  const mod = require('../../../../src/services/decay/timeDecay');
  return { ...mod, calls };
}

const now = new Date('2026-04-20T00:00:00Z');

describe('runDecay', () => {
  test('risk_score=50, last_event 10 天前 → 衰减为 45', async () => {
    const lastEvent = new Date(now.getTime() - 10 * 86400 * 1000).toISOString();
    const created = new Date(now.getTime() - 60 * 86400 * 1000).toISOString();
    const { runDecay, calls } = setup({
      users: [
        { id: 'u1', email: 'a@g.com', status: 'active', risk_score: 50, created_at: created, last_risk_event_at: lastEvent },
      ],
    });
    const summary = await runDecay(now);
    expect(summary.decayed).toBe(1);
    expect(calls.recorded[0].userId).toBe('u1');
    expect(calls.recorded[0].scoreDelta).toBe(-5); // 50 → 45
    expect(calls.recorded[0].ruleCode).toBe('TIME_DECAY');
    expect(calls.decayLogInserts[0].before_score).toBe(50);
    expect(calls.decayLogInserts[0].after_score).toBe(45);
  });

  test('新号（注册 <7 天）risk_score=50 → 衰减为 48 (factor=0.97)', async () => {
    const lastEvent = new Date(now.getTime() - 10 * 86400 * 1000).toISOString();
    const created = new Date(now.getTime() - 3 * 86400 * 1000).toISOString();
    const { runDecay, calls } = setup({
      users: [
        { id: 'u2', email: 'b@g.com', status: 'active', risk_score: 50, created_at: created, last_risk_event_at: lastEvent },
      ],
    });
    const summary = await runDecay(now);
    expect(summary.decayed).toBe(1);
    // floor(50 * 0.97) = 48, delta = -2
    expect(calls.recorded[0].scoreDelta).toBe(-2);
  });

  test('last_event 只 5 天前 → 跳过', async () => {
    const lastEvent = new Date(now.getTime() - 5 * 86400 * 1000).toISOString();
    const created = new Date(now.getTime() - 30 * 86400 * 1000).toISOString();
    const { runDecay, calls } = setup({
      users: [
        { id: 'u3', status: 'active', risk_score: 60, created_at: created, last_risk_event_at: lastEvent },
      ],
    });
    const summary = await runDecay(now);
    expect(summary.decayed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(calls.recorded.length).toBe(0);
  });

  test('newScore >= current（如 risk=1 × 0.9 = 0 → floor=0 → delta=-1）可衰减', async () => {
    const lastEvent = new Date(now.getTime() - 10 * 86400 * 1000).toISOString();
    const created = new Date(now.getTime() - 30 * 86400 * 1000).toISOString();
    const { runDecay, calls } = setup({
      users: [
        { id: 'u4', status: 'active', risk_score: 1, created_at: created, last_risk_event_at: lastEvent },
      ],
    });
    const summary = await runDecay(now);
    expect(summary.decayed).toBe(1);
    expect(calls.recorded[0].scoreDelta).toBe(-1);
  });

  test('空列表 → 不报错', async () => {
    const { runDecay } = setup({ users: [] });
    const summary = await runDecay(now);
    expect(summary.scanned).toBe(0);
    expect(summary.decayed).toBe(0);
  });
});
