// Phase 4: archiveRiskEvents 单元测试

afterEach(() => jest.resetModules());

function setup({ pages = [] } = {}) {
  const calls = { inserted: [], deleted: [] };
  let pageIdx = 0;

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'risk_events') {
        return {
          select: () => ({
            lt: () => ({
              order: () => ({
                limit: () => {
                  const data = pages[pageIdx] || [];
                  pageIdx++;
                  return Promise.resolve({ data, error: null });
                },
              }),
            }),
          }),
          delete: () => ({
            in: (col, vals) => {
              calls.deleted.push(vals);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'risk_events_archive') {
        return {
          insert: (rows) => {
            calls.inserted.push(rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
  }));

  const mod = require('../../../../src/services/archive/archiveRiskEvents');
  return { ...mod, calls };
}

describe('runArchive', () => {
  test('一批数据 → copied + deleted 相同数量', async () => {
    const batch = [
      { id: 'e1', user_id: 'u1', rule_code: 'X', score_delta: 5, reason: 'rule_trigger', evidence: {}, mode: 'enforce', created_at: '2025-01-01T00:00:00Z' },
      { id: 'e2', user_id: 'u2', rule_code: 'Y', score_delta: 5, reason: 'rule_trigger', evidence: {}, mode: 'enforce', created_at: '2025-01-02T00:00:00Z' },
    ];
    const { runArchive, calls } = setup({ pages: [batch, []] });
    const summary = await runArchive(90, 500);
    expect(summary.copied).toBe(2);
    expect(summary.deleted).toBe(2);
    expect(calls.inserted[0].length).toBe(2);
    expect(calls.inserted[0][0]).toHaveProperty('archived_at');
    expect(calls.deleted[0]).toEqual(['e1', 'e2']);
  });

  test('空 → batches=0', async () => {
    const { runArchive } = setup({ pages: [[]] });
    const summary = await runArchive(90, 500);
    expect(summary.copied).toBe(0);
    expect(summary.batches).toBe(0);
  });

  test('分批循环：第一批 size=batchSize 继续；小于 batchSize 停止', async () => {
    const mkBatch = (n, prefix) =>
      Array.from({ length: n }).map((_, i) => ({
        id: `${prefix}${i}`,
        user_id: 'u',
        rule_code: 'X',
        score_delta: 1,
        reason: 'rule_trigger',
        evidence: {},
        mode: 'enforce',
        created_at: '2025-01-01T00:00:00Z',
      }));
    const { runArchive, calls } = setup({
      pages: [mkBatch(500, 'a'), mkBatch(100, 'b')],
    });
    const summary = await runArchive(90, 500);
    expect(summary.batches).toBe(2);
    expect(summary.copied).toBe(600);
    expect(calls.inserted.length).toBe(2);
  });
});
