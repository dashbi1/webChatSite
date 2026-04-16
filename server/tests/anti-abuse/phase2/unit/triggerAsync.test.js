// triggerAsync / ensureAbuse 单元测试

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe('ensureAbuse', () => {
  test('req.abuse 已存在 → 保留原值', () => {
    jest.doMock('../../../../src/config/supabase', () => ({ from: () => ({}) }));
    const { ensureAbuse } = require('../../../../src/services/riskEngine/triggerAsync');
    const req = { abuse: { ip: 'already', ipCidr24: null, fingerprintHash: 'fp' }, headers: {} };
    ensureAbuse(req);
    expect(req.abuse.ip).toBe('already');
  });

  test('req.abuse 缺失 → 补齐', () => {
    jest.doMock('../../../../src/config/supabase', () => ({ from: () => ({}) }));
    process.env.DEPLOY_MODE = 'ip';
    const { ensureAbuse } = require('../../../../src/services/riskEngine/triggerAsync');
    const req = {
      ip: '1.2.3.4',
      headers: { 'x-device-fingerprint': 'my-hash' },
    };
    ensureAbuse(req);
    expect(req.abuse.ip).toBe('1.2.3.4');
    expect(req.abuse.ipCidr24).toBe('1.2.3.0/24');
    expect(req.abuse.fingerprintHash).toBe('my-hash');
  });

  test('无 fingerprint header → fingerprintHash=null', () => {
    jest.doMock('../../../../src/config/supabase', () => ({ from: () => ({}) }));
    const { ensureAbuse } = require('../../../../src/services/riskEngine/triggerAsync');
    const req = { headers: {}, ip: '1.1.1.1' };
    ensureAbuse(req);
    expect(req.abuse.fingerprintHash).toBeNull();
  });
});

describe('fetchFreshUser', () => {
  test('返回 user 对象', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'u1', email: 'a@b.com' } }),
          }),
        }),
      }),
    }));
    const { fetchFreshUser } = require('../../../../src/services/riskEngine/triggerAsync');
    const u = await fetchFreshUser('u1');
    expect(u).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  test('不存在 → null', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    }));
    const { fetchFreshUser } = require('../../../../src/services/riskEngine/triggerAsync');
    const u = await fetchFreshUser('nope');
    expect(u).toBeNull();
  });

  test('error → null', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    }));
    const { fetchFreshUser } = require('../../../../src/services/riskEngine/triggerAsync');
    const u = await fetchFreshUser('x');
    expect(u).toBeNull();
  });
});

describe('triggerRiskEval', () => {
  test('userId 空时直接返回', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({ from: () => ({}) }));
    const { triggerRiskEval } = require('../../../../src/services/riskEngine/triggerAsync');
    // 调用不应抛
    expect(() => triggerRiskEval(null, 'register', { headers: {} }, {})).not.toThrow();
    expect(() => triggerRiskEval(undefined, 'register', { headers: {} }, {})).not.toThrow();
    // 微任务让内部 async 跑完
    await new Promise((r) => setImmediate(r));
  });

  test('fire-and-forget：即使 evaluate 抛错也不冒泡', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'u1', email: 'a@b.com', risk_score: 0 },
            }),
          }),
        }),
      }),
    }));
    jest.doMock('../../../../src/services/riskEngine/index', () => ({
      evaluate: jest.fn(async () => { throw new Error('downstream boom'); }),
    }));
    const { triggerRiskEval } = require('../../../../src/services/riskEngine/triggerAsync');
    expect(() =>
      triggerRiskEval('u1', 'register', { headers: {}, ip: '1.1.1.1' }, {})
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
