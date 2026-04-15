// 风控引擎端到端单测：mock ruleCache + mock recordEvent，验证 evaluate 逐条跑规则、
// 触发的规则被 recordEvent 收集

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function loadEngineWithMocks({
  rules = [],
  recordedEvents = [],
  systemConfigValues = {},
} = {}) {
  jest.doMock('../../../../src/services/riskEngine/ruleCache', () => ({
    getRules: jest.fn(async () => rules),
    getRule: jest.fn(async (code) => rules.find((r) => r.code === code) || null),
    invalidate: jest.fn(),
  }));

  jest.doMock('../../../../src/services/riskEngine/scoreStore', () => ({
    recordEvent: jest.fn(async (e) => {
      recordedEvents.push(e);
      return { recorded: true, appliedDelta: e.scoreDelta, mode: 'enforce' };
    }),
  }));

  jest.doMock('../../../../src/services/config/systemConfig', () => ({
    getSystemConfig: jest.fn(async (k, d) => systemConfigValues[k] ?? d),
    setSystemConfig: jest.fn(),
    _clearCache: jest.fn(),
  }));

  return require('../../../../src/services/riskEngine');
}

describe('riskEngine.evaluate', () => {
  const user = { id: 'user-1', email: 'a@b.com', risk_score: 0 };

  test('无规则 → 无触发', async () => {
    const events = [];
    const engine = loadEngineWithMocks({ recordedEvents: events });
    const res = await engine.evaluate({ user, action: 'post_create', req: {}, context: {} });
    expect(res.triggered).toEqual([]);
    expect(events).toEqual([]);
  });

  test('disabled 规则不跑', async () => {
    const events = [];
    const rules = [
      { code: 'R1', enabled: false, score: 10, params: {} },
    ];
    const engine = loadEngineWithMocks({ rules, recordedEvents: events });
    const impl = { evaluate: jest.fn(() => ({ triggered: true })) };
    engine.registerRule('R1', impl);
    await engine.evaluate({ user, action: 'x', req: {}, context: {} });
    expect(impl.evaluate).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  test('enabled 规则触发 → 写入 events', async () => {
    const events = [];
    const rules = [
      { code: 'R_HIT', enabled: true, score: 20, params: {} },
      { code: 'R_MISS', enabled: true, score: 30, params: {} },
    ];
    const engine = loadEngineWithMocks({ rules, recordedEvents: events });
    engine.registerRule('R_HIT', {
      evaluate: () => ({ triggered: true, evidence: { foo: 'bar' } }),
    });
    engine.registerRule('R_MISS', {
      evaluate: () => ({ triggered: false }),
    });

    const res = await engine.evaluate({ user, action: 'x', req: {}, context: {} });
    expect(res.triggered).toHaveLength(1);
    expect(res.triggered[0].code).toBe('R_HIT');
    expect(res.triggered[0].score).toBe(20);
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe('user-1');
    expect(events[0].ruleCode).toBe('R_HIT');
    expect(events[0].scoreDelta).toBe(20);
    expect(events[0].evidence).toEqual({ foo: 'bar' });
  });

  test('规则抛错不影响其他规则', async () => {
    const events = [];
    const rules = [
      { code: 'R_THROW', enabled: true, score: 10, params: {} },
      { code: 'R_OK', enabled: true, score: 20, params: {} },
    ];
    const engine = loadEngineWithMocks({ rules, recordedEvents: events });
    engine.registerRule('R_THROW', {
      evaluate: () => { throw new Error('boom'); },
    });
    engine.registerRule('R_OK', {
      evaluate: () => ({ triggered: true }),
    });

    const res = await engine.evaluate({ user, action: 'x', req: {}, context: {} });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].code).toBe('R_THROW');
    expect(res.triggered).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  test('未注册 impl 的规则跳过', async () => {
    const events = [];
    const rules = [{ code: 'UNREGISTERED', enabled: true, score: 100, params: {} }];
    const engine = loadEngineWithMocks({ rules, recordedEvents: events });
    const res = await engine.evaluate({ user, action: 'x', req: {}, context: {} });
    expect(res.triggered).toEqual([]);
    expect(events).toEqual([]);
  });

  test('无 user 或 user.id 缺失 → 直接返回空', async () => {
    const engine = loadEngineWithMocks({ rules: [] });
    const res1 = await engine.evaluate({ user: null, action: 'x', req: {} });
    expect(res1.triggered).toEqual([]);
    const res2 = await engine.evaluate({ user: {}, action: 'x', req: {} });
    expect(res2.triggered).toEqual([]);
  });
});
