// Phase 4 集成：dailyRewardWeeklyActive cron
//   - 近 7 天活跃用户：A (无违规 → 奖励) / B (违规 ≥10 → 跳过)

afterEach(() => jest.resetModules());

describe('dailyRewardWeeklyActive cron', () => {
  test('仅对"近 7 天 score_delta<10"的活跃用户发奖', async () => {
    const captured = { rewardCalls: [] };

    jest.doMock('../../../../src/services/decay/positiveReward', () => ({
      rewardWeeklyActiveClean: async (userId) => {
        captured.rewardCalls.push(userId);
        return { applied: true };
      },
    }));

    jest.doMock('../../../../src/config/supabase', () => {
      const userEvents = {
        A: [{ score_delta: 2 }],   // 累计 2 < 10 → 奖励
        B: [{ score_delta: 20 }],  // 累计 20 >= 10 → 跳过
      };

      const rpc = async (name) => {
        if (name === 'list_recent_active_users') {
          return { data: [
            { user_id: 'A', last_seen_at: '2026-04-20T00:00:00Z' },
            { user_id: 'B', last_seen_at: '2026-04-20T00:00:00Z' },
          ], error: null };
        }
        return { data: [], error: null };
      };

      const from = (table) => {
        if (table !== 'risk_events') return {};
        let capturedUserId = null;
        const builder = {
          select: () => builder,
          eq: (col, val) => {
            if (col === 'user_id') capturedUserId = val;
            return builder;
          },
          gte: () => Promise.resolve({
            data: userEvents[capturedUserId] || [],
            error: null,
          }),
        };
        return builder;
      };

      return { rpc, from };
    });

    const { runDailyRewardWeeklyActive } = require('../../../../src/cron/dailyRewardWeeklyActive');
    const summary = await runDailyRewardWeeklyActive();

    expect(summary.active).toBe(2);
    expect(captured.rewardCalls).toEqual(['A']);
    expect(summary.rewarded).toBe(1);
    expect(summary.skippedNoisy).toBe(1);
  });
});
