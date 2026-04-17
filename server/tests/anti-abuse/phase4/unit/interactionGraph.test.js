// Phase 4: interactionGraph 图算法单元测试

const {
  buildAdjacency,
  findConnectedComponents,
  computeClusterStats,
} = require('../../../../src/services/cluster/interactionGraph');

describe('buildAdjacency', () => {
  test('无向边构图', () => {
    const adj = buildAdjacency(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    expect(adj.get('A').has('B')).toBe(true);
    expect(adj.get('B').has('A')).toBe(true);
    expect(adj.get('B').has('C')).toBe(true);
    expect(adj.get('C').has('B')).toBe(true);
    expect(adj.get('A').has('C')).toBe(false);
  });
});

describe('findConnectedComponents', () => {
  test('3 节点全连通 → 1 个 component size 3', () => {
    const adj = buildAdjacency(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['A', 'C']]);
    const comps = findConnectedComponents(adj);
    expect(comps.length).toBe(1);
    expect(comps[0].size).toBe(3);
  });

  test('A-B 和独立 C → 2 个 component', () => {
    const adj = buildAdjacency(['A', 'B', 'C'], [['A', 'B']]);
    const comps = findConnectedComponents(adj);
    const sizes = comps.map(c => c.size).sort();
    expect(sizes).toEqual([1, 2]);
  });
});

describe('computeClusterStats', () => {
  test('3 个全互动新号 → internalRate = 1.0', () => {
    const comp = new Set(['A', 'B', 'C']);
    const edges = [['A', 'B'], ['A', 'C'], ['B', 'C']];
    const stats = computeClusterStats(comp, edges);
    expect(stats.size).toBe(3);
    expect(stats.internal).toBe(3);
    expect(stats.internalRate).toBe(1);
    expect(stats.maxExternal).toBe(0);
  });

  test('3 成员 + 外部互动 → maxExternal > 0', () => {
    const comp = new Set(['A', 'B', 'C']);
    const edges = [
      ['A', 'B'], ['B', 'C'],    // 2 条内部边
      ['A', 'X1'], ['A', 'X2'], ['A', 'X3'], // A 外部 3 条
      ['B', 'Y1'], // B 外部 1 条
    ];
    const stats = computeClusterStats(comp, edges);
    expect(stats.internal).toBe(2);
    expect(stats.internalRate).toBeCloseTo(2 / 3);
    expect(stats.maxExternal).toBe(3);
  });

  test('size=1 possibleInternal=0 → internalRate=0', () => {
    const comp = new Set(['A']);
    const stats = computeClusterStats(comp, []);
    expect(stats.internalRate).toBe(0);
  });
});
