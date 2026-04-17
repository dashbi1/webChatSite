// Phase 4: sameCluster 单元测试

afterEach(() => jest.resetModules());

function setup({ rows = [], error = null } = {}) {
  const filterCalls = {};
  jest.doMock('../../../../src/config/supabase', () => ({
    from: (_table) => ({
      select: () => ({
        in: (col, val) => {
          filterCalls.statusIn = val;
          return {
            contains: (col2, val2) => {
              filterCalls.containsCol = col2;
              filterCalls.containsVal = val2;
              return {
                limit: () => Promise.resolve({ data: rows, error }),
              };
            },
          };
        },
      }),
    }),
  }));
  const mod = require('../../../../src/services/cluster/sameCluster');
  return { ...mod, filterCalls };
}

describe('isInSameCluster', () => {
  test('A 和 B 同时出现在 pending cluster → true', async () => {
    const { isInSameCluster } = setup({
      rows: [
        { id: 'c1', member_ids: ['A', 'B', 'C'] },
      ],
    });
    const r = await isInSameCluster('A', 'B');
    expect(r).toBe(true);
  });

  test('A 有 cluster 但 B 不在 → false', async () => {
    const { isInSameCluster } = setup({
      rows: [{ id: 'c1', member_ids: ['A', 'X'] }],
    });
    const r = await isInSameCluster('A', 'B');
    expect(r).toBe(false);
  });

  test('两人相同输入 → false（不视为同簇）', async () => {
    const { isInSameCluster } = setup({ rows: [] });
    const r = await isInSameCluster('A', 'A');
    expect(r).toBe(false);
  });

  test('空输入 → false', async () => {
    const { isInSameCluster } = setup({ rows: [] });
    expect(await isInSameCluster(null, 'B')).toBe(false);
    expect(await isInSameCluster('A', null)).toBe(false);
  });

  test('查询条件仅包含活跃状态（pending/reviewed/banned）', async () => {
    const { isInSameCluster, filterCalls } = setup({ rows: [] });
    await isInSameCluster('A', 'B');
    expect(filterCalls.statusIn).toEqual(['pending', 'reviewed', 'banned']);
  });

  test('error 时 false', async () => {
    const { isInSameCluster } = setup({ rows: null, error: { message: 'x' } });
    const r = await isInSameCluster('A', 'B');
    expect(r).toBe(false);
  });
});
