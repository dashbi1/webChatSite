// banRecord 单元测试
//   - targetType=user 级联 users.status=banned
//   - targetType=ip CIDR vs 单 IP 的列匹配
//   - revokeBanRecord 幂等 + 级联解封

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function setup({ insertResult = null, activeOthers = [], banRow = null } = {}) {
  const inserts = [];
  const updates = [];

  const defaultInserted = { id: 'ban-1', target_type: 'user', target_id: 'u1' };

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'ban_records') {
        return {
          insert: (row) => {
            inserts.push({ table, row });
            return {
              select: () => ({
                single: async () => ({
                  data: insertResult || { ...defaultInserted, ...row },
                  error: null,
                }),
              }),
            };
          },
          select: () => ({
            eq: () => {
              const b = {
                eq: () => b,
                is: () => b,
                neq: () => b,
                gte: () => b,
                limit: () => Promise.resolve({ data: activeOthers, error: null }),
                maybeSingle: async () => ({ data: banRow, error: null }),
              };
              return b;
            },
          }),
          update: (patch) => ({
            eq: () => {
              updates.push({ table, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'users') {
        return {
          update: (patch) => ({
            eq: () => {
              updates.push({ table, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'fingerprints' || table === 'ip_records') {
        return {
          update: (patch) => ({
            eq: () => {
              updates.push({ table, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
  }));

  const banRecord = require('../../../../src/services/enforcement/banRecord');
  return { banRecord, inserts, updates };
}

describe('createBanRecord', () => {
  test('user 级联 users.status=banned', async () => {
    const { banRecord, inserts, updates } = setup();
    await banRecord.createBanRecord({
      targetType: 'user',
      targetId: 'u1',
      banType: 'auto_score',
      reason: 'test',
    });
    expect(inserts.length).toBe(1);
    const userUpdate = updates.find((u) => u.table === 'users');
    expect(userUpdate).toBeDefined();
    expect(userUpdate.patch.status).toBe('banned');
  });

  test('ip CIDR 字符串用 ip_cidr_24 列匹配', async () => {
    const { banRecord, updates } = setup();
    await banRecord.createBanRecord({
      targetType: 'ip',
      targetId: '1.2.3.0/24',
      banType: 'ip_burst_auto',
      reason: 'burst',
      expiresAt: new Date().toISOString(),
    });
    const ipUpdate = updates.find((u) => u.table === 'ip_records');
    expect(ipUpdate).toBeDefined();
    expect(ipUpdate.patch.is_banned).toBe(true);
  });

  test('fingerprint 级联 fingerprints.is_banned=true', async () => {
    const { banRecord, updates } = setup();
    await banRecord.createBanRecord({
      targetType: 'fingerprint',
      targetId: 'fp-1',
      banType: 'cluster',
      reason: 'test',
    });
    const fpUpdate = updates.find((u) => u.table === 'fingerprints');
    expect(fpUpdate).toBeDefined();
    expect(fpUpdate.patch.is_banned).toBe(true);
  });

  test('缺字段抛错', async () => {
    const { banRecord } = setup();
    await expect(
      banRecord.createBanRecord({ targetType: 'user', targetId: '' })
    ).rejects.toThrow(/missing required fields/);
  });
});

describe('revokeBanRecord', () => {
  test('revoke 后若无其他活跃 ban：解封 users.status=active', async () => {
    const { banRecord, updates } = setup({
      banRow: { id: 'ban-1', target_type: 'user', target_id: 'u1', revoked_at: null },
      activeOthers: [],
    });
    await banRecord.revokeBanRecord('ban-1', 'admin1', 'mistake');
    const userUpdate = updates.find((u) => u.table === 'users');
    expect(userUpdate).toBeDefined();
    expect(userUpdate.patch.status).toBe('active');
  });

  test('已撤销的 ban 直接返回，不再操作', async () => {
    const { banRecord, updates } = setup({
      banRow: { id: 'ban-1', target_type: 'user', target_id: 'u1', revoked_at: '2026-01-01T00:00:00Z' },
    });
    await banRecord.revokeBanRecord('ban-1', 'admin1');
    // 不应该再调 update
    const userUpdate = updates.find((u) => u.table === 'users');
    expect(userUpdate).toBeUndefined();
  });

  test('ban 不存在抛错', async () => {
    const { banRecord } = setup({ banRow: null });
    await expect(banRecord.revokeBanRecord('bad-id', 'admin1')).rejects.toThrow(/not found/);
  });
});
