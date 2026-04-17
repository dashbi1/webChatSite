// Phase 4: isolatedIslandDetect 单元测试

afterEach(() => jest.resetModules());

function setup({
  rule = {
    code: 'ISOLATED_ISLAND',
    enabled: true,
    score: 10,
    params: {
      internal_rate_threshold: 0.6,
      external_max_per_user: 3,
      new_days: 7,
      min_cluster_size: 3,
    },
  },
  newUsers = [],
  edges = [],
  existingClusters = [],
  appliedDelta = 10,
} = {}) {
  const calls = { clusterInserts: [], recorded: [] };

  jest.doMock('../../../../src/services/riskEngine/ruleCache', () => ({
    getRules: async () => [rule],
  }));

  jest.doMock('../../../../src/services/riskEngine/dedupDecay', () => ({
    computeAppliedDelta: jest.fn(async () => appliedDelta),
  }));

  jest.doMock('../../../../src/services/riskEngine/scoreStore', () => ({
    recordEvent: jest.fn(async (args) => {
      calls.recorded.push(args);
      return { recorded: true };
    }),
  }));

  jest.doMock('../../../../src/services/cluster/interactionGraph', () => ({
    collectInteractionEdges: jest.fn(async () => edges),
    buildAdjacency: jest.requireActual('../../../../src/services/cluster/interactionGraph').buildAdjacency,
    findConnectedComponents: jest.requireActual('../../../../src/services/cluster/interactionGraph').findConnectedComponents,
    computeClusterStats: jest.requireActual('../../../../src/services/cluster/interactionGraph').computeClusterStats,
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          select: () => ({
            gte: () => Promise.resolve({ data: newUsers, error: null }),
          }),
        };
      }
      if (table === 'account_clusters') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                contains: () => ({
                  limit: () => Promise.resolve({ data: existingClusters, error: null }),
                }),
              }),
            }),
          }),
          insert: (row) => {
            calls.clusterInserts.push(row);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'cluster-1' }, error: null }),
              }),
            };
          },
        };
      }
      return {};
    },
  }));

  const mod = require('../../../../src/services/cluster/isolatedIslandDetect');
  return { ...mod, calls };
}

describe('detect', () => {
  test('规则 disabled → skip', async () => {
    const { detect } = setup({
      rule: { code: 'ISOLATED_ISLAND', enabled: false, score: 10, params: {} },
    });
    const r = await detect();
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('rule_disabled');
  });

  test('新用户数 < minSize → skip', async () => {
    const { detect } = setup({
      newUsers: [{ id: 'A' }, { id: 'B' }],
      edges: [],
    });
    const r = await detect();
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('too_few_new_users');
  });

  test('无边 → skip no_edges', async () => {
    const { detect } = setup({
      newUsers: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [],
    });
    const r = await detect();
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('no_edges');
  });

  test('3 人全互动 → 识别为孤岛簇', async () => {
    const { detect, calls } = setup({
      newUsers: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [['A', 'B'], ['A', 'C'], ['B', 'C']],
    });
    const r = await detect();
    expect(r.detectedClusters).toBe(1);
    expect(r.members).toBe(3);
    expect(calls.clusterInserts[0].cluster_type).toBe('isolated_island');
    expect(calls.clusterInserts[0].status).toBe('pending');
    expect(calls.clusterInserts[0].member_ids).toEqual(['A', 'B', 'C']);
    expect(calls.recorded.length).toBe(3);
  });

  test('某成员外部互动 >= 3 → 不识别', async () => {
    const { detect } = setup({
      newUsers: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'X1' }, { id: 'X2' }, { id: 'X3' }],
      edges: [
        ['A', 'B'], ['A', 'C'], ['B', 'C'],
        ['A', 'X1'], ['A', 'X2'], ['A', 'X3'],
      ],
    });
    const r = await detect();
    expect(r.detectedClusters).toBe(0);
  });

  test('24h 内已有同 member_ids cluster → 跳过不重复写', async () => {
    const { detect, calls } = setup({
      newUsers: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [['A', 'B'], ['A', 'C'], ['B', 'C']],
      existingClusters: [{ id: 'prev-1' }],
    });
    const r = await detect();
    expect(r.detectedClusters).toBe(0);
    expect(calls.clusterInserts.length).toBe(0);
  });
});
