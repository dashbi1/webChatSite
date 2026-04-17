// Phase 4: positiveReward 单元测试

afterEach(() => jest.resetModules());

function setup({
  user = null,
  cooldownOk = true,
  sameCluster = false,
  recordEventResult = { recorded: true, newScore: 0, mode: 'enforce' },
} = {}) {
  const calls = { recorded: [], decayLogInserts: [], cooldownKeys: [] };

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: jest.fn(async (key, def) => {
      if (key === 'new_account_protection_days') return 7;
      return def;
    }),
  }));

  jest.doMock('../../../../src/services/cluster/sameCluster', () => ({
    isInSameCluster: jest.fn(async () => sameCluster),
  }));

  jest.doMock('../../../../src/services/riskEngine/scoreStore', () => ({
    recordEvent: jest.fn(async (args) => {
      calls.recorded.push(args);
      return {
        ...recordEventResult,
        newScore:
          typeof recordEventResult.newScore === 'number'
            ? recordEventResult.newScore
            : Math.max(0, (user?.risk_score || 0) + args.scoreDelta),
      };
    }),
  }));

  jest.doMock('../../../../src/config/redis', () => ({
    getRedis: () => ({
      set: async (key) => {
        calls.cooldownKeys.push(key);
        return cooldownOk ? 'OK' : null;
      },
    }),
    isRedisNoop: () => false,
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: user, error: null }),
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

  const mod = require('../../../../src/services/decay/positiveReward');
  return { ...mod, calls };
}

const now = Date.now();
const oldUser = (risk, status = 'active') => ({
  id: 'u1',
  status,
  risk_score: risk,
  created_at: new Date(now - 30 * 86400 * 1000).toISOString(),
});
const newUser = (risk, status = 'active') => ({
  id: 'u1',
  status,
  risk_score: risk,
  created_at: new Date(now - 3 * 86400 * 1000).toISOString(),
});

describe('tryAddReward', () => {
  test('冷却命中 → skipped', async () => {
    const { tryAddReward } = setup({ user: oldUser(20), cooldownOk: false });
    const r = await tryAddReward('u1', 'reward_weekly_active', -5, {
      cooldownKey: 'reward:weekly:u1', cooldownSec: 7 * 86400,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('cooldown');
  });

  test('status=banned → skipped', async () => {
    const { tryAddReward } = setup({ user: oldUser(20, 'banned') });
    const r = await tryAddReward('u1', 'reward_weekly_active', -5);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('banned');
  });

  test('risk_score<=0 → skipped', async () => {
    const { tryAddReward } = setup({ user: oldUser(0) });
    const r = await tryAddReward('u1', 'reward_weekly_active', -5);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('no_score_to_reduce');
  });

  test('老号 baseDelta=-3 → effective=-3', async () => {
    const { tryAddReward, calls } = setup({ user: oldUser(20) });
    const r = await tryAddReward('u1', 'reward_post_liked_by_stranger', -3, {
      cooldownKey: 'reward:post:p1', cooldownSec: 365 * 86400,
    });
    expect(r.applied).toBe(true);
    expect(r.scoreDelta).toBe(-3);
    expect(calls.recorded[0].scoreDelta).toBe(-3);
    expect(calls.decayLogInserts[0].decay_type).toBe('reward_post_liked_by_stranger');
  });

  test('新号 baseDelta=-3 × 0.3 = -0.9 → ceil=0 → rounded_to_zero', async () => {
    const { tryAddReward } = setup({ user: newUser(20) });
    const r = await tryAddReward('u1', 'reward_post_liked_by_stranger', -3);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('rounded_to_zero');
  });

  test('新号 baseDelta=-5 × 0.3 = -1.5 → ceil=-1 → effective=-1', async () => {
    const { tryAddReward, calls } = setup({ user: newUser(20) });
    const r = await tryAddReward('u1', 'reward_weekly_active', -5);
    expect(r.applied).toBe(true);
    expect(r.scoreDelta).toBe(-1);
    expect(calls.recorded[0].scoreDelta).toBe(-1);
  });
});

describe('rewardPostLikedByStranger', () => {
  test('author === liker → skipped', async () => {
    const { rewardPostLikedByStranger } = setup({ user: oldUser(20) });
    const r = await rewardPostLikedByStranger({ postId: 'p1', authorId: 'u1', likerId: 'u1' });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('self');
  });

  test('同簇 → skipped', async () => {
    const { rewardPostLikedByStranger } = setup({ user: oldUser(20), sameCluster: true });
    const r = await rewardPostLikedByStranger({ postId: 'p1', authorId: 'A', likerId: 'B' });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('same_cluster');
  });

  test('非同簇 & 非本人 → 触发 tryAddReward', async () => {
    const { rewardPostLikedByStranger, calls } = setup({ user: oldUser(10) });
    const r = await rewardPostLikedByStranger({ postId: 'p1', authorId: 'u1', likerId: 'u2' });
    expect(r.applied).toBe(true);
    expect(calls.cooldownKeys[0]).toBe('reward:post:p1');
    expect(calls.recorded[0].ruleCode).toBe('REWARD_POST_LIKED_BY_STRANGER');
  });
});

describe('rewardFriendAccepted', () => {
  test('奖励申请方（requesterId），传入 addresseeId 仅用于同簇过滤', async () => {
    const { rewardFriendAccepted, calls } = setup({ user: oldUser(15) });
    const r = await rewardFriendAccepted({ requesterId: 'u1', addresseeId: 'u2' });
    expect(r.applied).toBe(true);
    expect(calls.recorded[0].userId).toBe('u1');
    expect(calls.recorded[0].scoreDelta).toBe(-3);
  });
});
