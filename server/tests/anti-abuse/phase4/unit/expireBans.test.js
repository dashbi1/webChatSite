// Phase 4: expireBans 单元测试

afterEach(() => jest.resetModules());

function setup({ banRows = [], userFor = null } = {}) {
  const calls = { banUpdates: [], userUpdates: [], fpUpdates: [], ipUpdates: [] };

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'ban_records') {
        return {
          select: () => ({
            lte: () => ({
              is: () => ({
                limit: () => Promise.resolve({ data: banRows, error: null }),
              }),
            }),
          }),
          update: (patch) => ({
            eq: (col, val) => {
              calls.banUpdates.push({ patch, col, val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: userFor, error: null }),
            }),
          }),
          update: (patch) => ({
            eq: (col, val) => {
              calls.userUpdates.push({ patch, col, val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'fingerprints') {
        return {
          update: (patch) => ({
            eq: (col, val) => {
              calls.fpUpdates.push({ patch, col, val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'ip_records') {
        return {
          update: (patch) => ({
            eq: (col, val) => {
              calls.ipUpdates.push({ patch, col, val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
  }));

  const mod = require('../../../../src/services/enforcement/expireBans');
  return { ...mod, calls };
}

const now = new Date('2026-04-20T00:00:00Z');

describe('runExpireBans', () => {
  test('fingerprint 过期 → is_banned=false', async () => {
    const { runExpireBans, calls } = setup({
      banRows: [
        { id: 'b1', target_type: 'fingerprint', target_id: 'fp1', expires_at: '2026-04-19T00:00:00Z' },
      ],
    });
    const s = await runExpireBans(now);
    expect(s.revoked).toBe(1);
    expect(s.fingerprint).toBe(1);
    expect(calls.banUpdates[0].patch.revoked_at).toBeDefined();
    expect(calls.banUpdates[0].patch.revoke_reason).toBe('auto_expired');
    expect(calls.fpUpdates[0].patch.is_banned).toBe(false);
  });

  test('ip 过期 → ip_records.is_banned=false', async () => {
    const { runExpireBans, calls } = setup({
      banRows: [
        { id: 'b2', target_type: 'ip', target_id: '1.2.3.4', expires_at: '2026-04-19T00:00:00Z' },
      ],
    });
    const s = await runExpireBans(now);
    expect(s.ip).toBe(1);
    expect(calls.ipUpdates[0].patch.is_banned).toBe(false);
    expect(calls.ipUpdates[0].val).toBe('1.2.3.4');
  });

  test('user 到期 + risk_score<85 → status=active', async () => {
    const { runExpireBans, calls } = setup({
      banRows: [
        { id: 'b3', target_type: 'user', target_id: 'u1', expires_at: '2026-04-19T00:00:00Z' },
      ],
      userFor: { id: 'u1', status: 'banned', risk_score: 50 },
    });
    const s = await runExpireBans(now);
    expect(s.user).toBe(1);
    expect(calls.userUpdates[0].patch.status).toBe('active');
  });

  test('user 到期但 risk_score>=85 → 不恢复 active', async () => {
    const { runExpireBans, calls } = setup({
      banRows: [
        { id: 'b4', target_type: 'user', target_id: 'u1', expires_at: '2026-04-19T00:00:00Z' },
      ],
      userFor: { id: 'u1', status: 'banned', risk_score: 90 },
    });
    await runExpireBans(now);
    expect(calls.userUpdates.length).toBe(0);
  });

  test('空列表 → 不报错', async () => {
    const { runExpireBans } = setup({ banRows: [] });
    const s = await runExpireBans(now);
    expect(s.scanned).toBe(0);
    expect(s.revoked).toBe(0);
  });
});
