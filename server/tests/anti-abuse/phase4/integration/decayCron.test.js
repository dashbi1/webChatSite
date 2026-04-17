// Phase 4 集成：decayCron 通过 recordEvent 写 risk_events + 额外写 decay_log

afterEach(() => jest.resetModules());

describe('decayCron integration', () => {
  test('衰减流程：用户 → recordEvent → decay_log 同时写', async () => {
    const now = new Date('2026-05-01T02:00:00Z');
    const created = new Date(now.getTime() - 60 * 86400 * 1000).toISOString();
    const lastEvent = new Date(now.getTime() - 10 * 86400 * 1000).toISOString();

    const u = {
      id: 'user-1', email: 'x@g.com', status: 'active',
      risk_score: 80, created_at: created, last_risk_event_at: lastEvent,
    };

    const captured = { recorded: [], decayLog: [] };

    jest.doMock('../../../../src/services/config/systemConfig', () => ({
      getSystemConfig: async (key, def) => {
        if (key === 'score_decay_factor') return 0.9;
        if (key === 'new_account_protection_days') return 7;
        if (key === 'risk_enforcement_mode') return 'enforce';
        return def;
      },
    }));

    jest.doMock('../../../../src/services/riskEngine/scoreStore', () => ({
      recordEvent: async (args) => {
        captured.recorded.push(args);
        return { recorded: true, mode: 'enforce', newScore: 72, appliedDelta: -8 };
      },
    }));

    jest.doMock('../../../../src/config/supabase', () => ({
      from: (table) => {
        if (table === 'users') {
          return {
            select: () => ({
              gt: () => ({ neq: () => ({ order: () => ({
                range: () => Promise.resolve({ data: [u], error: null }),
              }) }) }),
            }),
          };
        }
        if (table === 'risk_score_decay_log') {
          return {
            insert: (row) => {
              captured.decayLog.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        return {};
      },
    }));

    const { runDecay } = require('../../../../src/services/decay/timeDecay');
    const summary = await runDecay(now);
    expect(summary.decayed).toBe(1);
    expect(captured.recorded.length).toBe(1);
    expect(captured.recorded[0].ruleCode).toBe('TIME_DECAY');
    expect(captured.recorded[0].reason).toBe('decay');
    expect(captured.recorded[0].scoreDelta).toBe(-8); // floor(80*0.9)=72，delta=-8
    expect(captured.decayLog.length).toBe(1);
    expect(captured.decayLog[0].before_score).toBe(80);
    expect(captured.decayLog[0].after_score).toBe(72);
    expect(captured.decayLog[0].decay_type).toBe('time_decay');
  });
});
