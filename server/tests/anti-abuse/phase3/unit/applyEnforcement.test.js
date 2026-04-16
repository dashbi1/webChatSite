// applyEnforcement 单元测试
// 验证 score 分段映射、白名单豁免、observe 模式、updates 内容

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function setup({ mode = 'enforce', updateResult = { error: null }, insertClusters = null } = {}) {
  const updateCalls = [];
  const insertCalls = [];
  const banRecordCalls = [];

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: jest.fn(async (key) => {
      if (key === 'risk_enforcement_mode') return mode;
      return null;
    }),
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          update: (patch) => ({
            eq: (_col, _val) => {
              updateCalls.push({ table, patch });
              return Promise.resolve(updateResult);
            },
          }),
        };
      }
      if (table === 'account_clusters') {
        return {
          insert: (row) => {
            insertCalls.push({ table, row });
            return Promise.resolve(insertClusters || { error: null });
          },
        };
      }
      return {};
    },
  }));

  jest.doMock('../../../../src/services/enforcement/banRecord', () => ({
    createBanRecord: jest.fn(async (args) => {
      banRecordCalls.push(args);
      return { id: 'ban-fake', ...args };
    }),
  }));

  const { applyEnforcement, scoreToLevel } = require('../../../../src/services/enforcement/applyEnforcement');
  return { applyEnforcement, scoreToLevel, updateCalls, insertCalls, banRecordCalls };
}

describe('scoreToLevel', () => {
  test('分段正确', () => {
    const { scoreToLevel } = setup();
    expect(scoreToLevel(0)).toBe('normal');
    expect(scoreToLevel(39)).toBe('normal');
    expect(scoreToLevel(40)).toBe('restricted');
    expect(scoreToLevel(69)).toBe('restricted');
    expect(scoreToLevel(70)).toBe('frozen');
    expect(scoreToLevel(84)).toBe('frozen');
    expect(scoreToLevel(85)).toBe('banned');
    expect(scoreToLevel(200)).toBe('banned');
  });
});

describe('applyEnforcement (enforce mode)', () => {
  test('score < 40: 清理降权（updates 全 null）', async () => {
    const { applyEnforcement, updateCalls } = setup();
    const user = { id: 'u1', email: 'a@example.com', risk_score: 10, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.level).toBe('normal');
    expect(result.enforced).toBe(false);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].patch.is_shadow_banned).toBe(false);
    expect(updateCalls[0].patch.restricted_until).toBe(null);
  });

  test('score=45：shadow ban 生效 + shadow_ban_until 14 天后', async () => {
    const { applyEnforcement, updateCalls } = setup();
    const user = { id: 'u2', email: 'a@example.com', risk_score: 45, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.level).toBe('restricted');
    const patch = updateCalls[0].patch;
    expect(patch.is_shadow_banned).toBe(true);
    expect(patch.shadow_ban_until).toBeDefined();
    const diffMs = new Date(patch.shadow_ban_until).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(13 * 86400 * 1000);
    expect(diffMs).toBeLessThan(15 * 86400 * 1000);
  });

  test('score=75：frozen，restricted_until 7 天后', async () => {
    const { applyEnforcement, updateCalls } = setup();
    const user = { id: 'u3', email: 'a@example.com', risk_score: 75, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.level).toBe('frozen');
    const patch = updateCalls[0].patch;
    expect(patch.restricted_until).toBeDefined();
    const diffMs = new Date(patch.restricted_until).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(6 * 86400 * 1000);
    expect(diffMs).toBeLessThan(8 * 86400 * 1000);
  });

  test('score=90 非白名单：status=banned + createBanRecord 被调用', async () => {
    const { applyEnforcement, updateCalls, banRecordCalls } = setup();
    const user = { id: 'u4', email: 'spammer@random.xyz', risk_score: 90, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.level).toBe('banned');
    expect(result.enforced).toBe(true);
    expect(banRecordCalls.length).toBe(1);
    expect(banRecordCalls[0].targetType).toBe('user');
    expect(banRecordCalls[0].banType).toBe('auto_score');
    expect(updateCalls[0].patch.status).toBe('banned');
  });

  test('score=90 白名单邮箱：不自动封，写 account_clusters pending', async () => {
    const { applyEnforcement, updateCalls, insertCalls, banRecordCalls } = setup();
    const user = { id: 'u5', email: 'student@hit.edu.cn', risk_score: 90, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.level).toBe('banned');
    expect(result.enforced).toBe(false);
    expect(result.whitelistShielded).toBe(true);
    expect(banRecordCalls.length).toBe(0);
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].table).toBe('account_clusters');
    expect(insertCalls[0].row.status).toBe('pending');
    // users 表 status 不应被改成 banned
    expect(updateCalls[0].patch.status).toBeUndefined();
  });

  test('gmail 白名单域名同样豁免', async () => {
    const { applyEnforcement, banRecordCalls } = setup();
    const user = { id: 'u6', email: 'a@gmail.com', risk_score: 100, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.whitelistShielded).toBe(true);
    expect(banRecordCalls.length).toBe(0);
  });
});

describe('applyEnforcement (observe mode)', () => {
  test('observe 模式下不修改 DB', async () => {
    const { applyEnforcement, updateCalls, banRecordCalls } = setup({ mode: 'observe' });
    const user = { id: 'u7', email: 'a@random.xyz', risk_score: 90, status: 'active' };
    const result = await applyEnforcement(user);
    expect(result.mode).toBe('observe');
    expect(result.enforced).toBe(false);
    expect(updateCalls.length).toBe(0);
    expect(banRecordCalls.length).toBe(0);
  });
});
