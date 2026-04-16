// 验证 scoreStore.recordEvent 成功加分后异步触发 applyEnforcement

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

// 等待一轮 setImmediate + microtask 完成
function flushImmediates() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup({ mode = 'enforce', currentScore = 50 } = {}) {
  const inserts = [];
  const updates = [];

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: async (key) => {
      if (key === 'risk_enforcement_mode') return mode;
      return null;
    },
  }));

  const applyEnforcement = jest.fn(async () => ({ enforced: true }));
  jest.doMock('../../../../src/services/enforcement/applyEnforcement', () => ({
    applyEnforcement,
    scoreToLevel: () => 'banned',
  }));

  jest.doMock('../../../../src/config/supabase', () => ({
    from: (table) => {
      if (table === 'risk_events') {
        return {
          insert: (row) => {
            inserts.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'u1', email: 'a@b.com', risk_score: currentScore, status: 'active' },
                error: null,
              }),
            }),
          }),
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

  const { recordEvent } = require('../../../../src/services/riskEngine/scoreStore');
  return { recordEvent, applyEnforcement, inserts, updates };
}

describe('scoreStore.recordEvent 闭环触发 applyEnforcement', () => {
  test('enforce 模式加分后异步调 applyEnforcement 一次', async () => {
    const { recordEvent, applyEnforcement } = setup({ mode: 'enforce', currentScore: 50 });
    await recordEvent({
      userId: 'u1',
      ruleCode: 'ASN_DATACENTER',
      scoreDelta: 45,
      reason: 'rule_trigger',
      evidence: {},
    });
    await flushImmediates(); // setImmediate 推迟的回调
    expect(applyEnforcement).toHaveBeenCalledTimes(1);
    const userArg = applyEnforcement.mock.calls[0][0];
    expect(userArg.id).toBe('u1');
  });

  test('observe 模式不应调用 applyEnforcement', async () => {
    const { recordEvent, applyEnforcement } = setup({ mode: 'observe', currentScore: 50 });
    await recordEvent({
      userId: 'u1',
      ruleCode: 'ASN_DATACENTER',
      scoreDelta: 45,
      reason: 'rule_trigger',
      evidence: {},
    });
    await flushImmediates();
    expect(applyEnforcement).not.toHaveBeenCalled();
  });

  test('分数到达上限不变（next===current）时不调 applyEnforcement', async () => {
    // currentScore=200, delta=+10 → next=200（clamp）→ 无变化
    const { recordEvent, applyEnforcement } = setup({ mode: 'enforce', currentScore: 200 });
    await recordEvent({
      userId: 'u1',
      ruleCode: 'X',
      scoreDelta: 10,
      reason: 'rule_trigger',
      evidence: {},
    });
    await flushImmediates();
    expect(applyEnforcement).not.toHaveBeenCalled();
  });
});
