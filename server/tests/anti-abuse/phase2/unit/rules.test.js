// 12 条规则的单元测试
// 原则：每条规则至少覆盖 "触发 / 不触发" 两个场景。需要 DB 查询的规则用 jest.doMock 替换 supabase。

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function mockSupabase(builder) {
  jest.doMock('../../../../src/config/supabase', () => builder);
}

// ============================================================
// REGISTER_QUICK_POST
// ============================================================
describe('REGISTER_QUICK_POST', () => {
  test('注册后 3 分钟发首帖 → 触发', async () => {
    mockSupabase({
      from: () => ({
        select: () => ({
          eq: () => ({
            // 返回 head + count
            async then(resolve) { resolve({ count: 1, error: null }); return Promise.resolve({ count: 1, error: null }); },
            count: 1,
          }),
        }),
      }),
    });
    // 上面 mock 过于复杂；直接 mock select 返回 Promise
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ count: 1, error: null }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/registerQuickPost');
    const user = { id: 'u1', created_at: new Date(Date.now() - 3 * 60000).toISOString() };
    const rule = { params: { threshold_minutes: 5 } };
    const r = await evaluate({ user, rule, action: 'post_create' });
    expect(r.triggered).toBe(true);
    expect(r.evidence.registered_min_ago).toBeCloseTo(3, 0);
  });

  test('注册 10 分钟后发帖 → 不触发（超过阈值）', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ count: 1, error: null }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/registerQuickPost');
    const user = { id: 'u1', created_at: new Date(Date.now() - 10 * 60000).toISOString() };
    const r = await evaluate({ user, rule: { params: {} }, action: 'post_create' });
    expect(r.triggered).toBe(false);
  });

  test('非首帖 → 不触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ count: 5, error: null }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/registerQuickPost');
    const user = { id: 'u1', created_at: new Date(Date.now() - 2 * 60000).toISOString() };
    const r = await evaluate({ user, rule: { params: {} }, action: 'post_create' });
    expect(r.triggered).toBe(false);
  });

  test('action 不是 post_create → 不触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: 1 }) }) }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/registerQuickPost');
    const r = await evaluate({ user: { id: 'u1', created_at: new Date().toISOString() }, rule: { params: {} }, action: 'register' });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// NEW_ACCOUNT_BURST
// ============================================================
describe('NEW_ACCOUNT_BURST', () => {
  test('24h > 5 帖 → 触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => Promise.resolve({ count: 8, error: null }),
          }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/newAccountBurst');
    const r = await evaluate({ user: { id: 'u1' }, rule: { params: {} }, action: 'post_create' });
    expect(r.triggered).toBe(true);
    expect(r.evidence.posts_in_window).toBe(8);
  });

  test('只有 3 帖 → 不触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ gte: () => Promise.resolve({ count: 3, error: null }) }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/newAccountBurst');
    const r = await evaluate({ user: { id: 'u1' }, rule: { params: {} }, action: 'post_create' });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// COLD_EMAIL_DOMAIN
// ============================================================
describe('COLD_EMAIL_DOMAIN', () => {
  test('gmail → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/coldEmailDomain');
    const r = await evaluate({ user: { email: 'a@gmail.com' }, rule: {}, action: 'register' });
    expect(r.triggered).toBe(false);
  });
  test('edu.cn → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/coldEmailDomain');
    const r = await evaluate({ user: { email: 's@hit.edu.cn' }, rule: {}, action: 'register' });
    expect(r.triggered).toBe(false);
  });
  test('冷门域 → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/coldEmailDomain');
    const r = await evaluate({ user: { email: 'a@random.xyz' }, rule: {}, action: 'register' });
    expect(r.triggered).toBe(true);
    expect(r.evidence.domain).toBe('random.xyz');
  });
  test('非 register action → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/coldEmailDomain');
    const r = await evaluate({ user: { email: 'a@random.xyz' }, rule: {}, action: 'post_create' });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// DEFAULT_PROFILE
// ============================================================
describe('DEFAULT_PROFILE', () => {
  const rule = { params: { default_nickname_pattern: '^用户[\\w]{4,8}$' } };

  test('昵称默认 + 无头像 → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/defaultProfile');
    const r = await evaluate({
      user: { nickname: '用户abc123', avatar_url: '' },
      rule, action: 'register',
    });
    expect(r.triggered).toBe(true);
  });
  test('有头像 → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/defaultProfile');
    const r = await evaluate({
      user: { nickname: '用户abc123', avatar_url: 'http://x/a.png' },
      rule, action: 'register',
    });
    expect(r.triggered).toBe(false);
  });
  test('自定义昵称 → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/defaultProfile');
    const r = await evaluate({
      user: { nickname: '张三', avatar_url: '' },
      rule, action: 'register',
    });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// APK_SIGNATURE_FAIL
// ============================================================
describe('APK_SIGNATURE_FAIL', () => {
  const cases = [
    ['absent', false],
    ['valid', false],
    ['bad_format', true],
    ['expired', true],
    ['sig_mismatch', true],
    ['hmac_mismatch', true],
  ];
  test.each(cases)('status=%s → triggered=%s', async (status, triggered) => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/apkSignatureFail');
    const r = await evaluate({ req: { apkSignatureStatus: status } });
    expect(r.triggered).toBe(triggered);
  });
  test('无 status（非 APK 请求） → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/apkSignatureFail');
    const r = await evaluate({ req: {} });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// EMULATOR_OR_ROOT
// ============================================================
describe('EMULATOR_OR_ROOT', () => {
  function makeReq(details) {
    const b64 = Buffer.from(JSON.stringify(details)).toString('base64');
    return { headers: { 'x-device-info': b64 } };
  }
  test('isRooted=true → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/emulatorOrRoot');
    const r = await evaluate({ req: makeReq({ isRooted: true, isEmulator: false }) });
    expect(r.triggered).toBe(true);
  });
  test('isEmulator=true → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/emulatorOrRoot');
    const r = await evaluate({ req: makeReq({ isRooted: false, isEmulator: true }) });
    expect(r.triggered).toBe(true);
  });
  test('正常设备 → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/emulatorOrRoot');
    const r = await evaluate({ req: makeReq({ isRooted: false, isEmulator: false }) });
    expect(r.triggered).toBe(false);
  });
  test('无 header → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/emulatorOrRoot');
    const r = await evaluate({ req: { headers: {} } });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// NO_FINGERPRINT
// ============================================================
describe('NO_FINGERPRINT', () => {
  test('有 hash → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/noFingerprint');
    const r = await evaluate({ req: { headers: { 'x-device-fingerprint': 'abc123' } } });
    expect(r.triggered).toBe(false);
  });
  test('无 hash → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/noFingerprint');
    const r = await evaluate({ req: { headers: {} } });
    expect(r.triggered).toBe(true);
  });
  test('空字符串 → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/noFingerprint');
    const r = await evaluate({ req: { headers: { 'x-device-fingerprint': '' } } });
    expect(r.triggered).toBe(true);
  });
});

// ============================================================
// ISOLATED_ISLAND（Phase 4 用，Phase 2 只验证接口）
// ============================================================
describe('ISOLATED_ISLAND', () => {
  test('非 cluster_detected action → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/isolatedIsland');
    const r = await evaluate({ action: 'post_create', context: {} });
    expect(r.triggered).toBe(false);
  });
  test('cluster_detected + evidence → 触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/isolatedIsland');
    const r = await evaluate({
      action: 'cluster_detected',
      context: { cluster_evidence: { size: 5, rate: 0.8 } },
    });
    expect(r.triggered).toBe(true);
    expect(r.evidence.size).toBe(5);
  });
});

// ============================================================
// DEVICE_MULTI_ACCOUNT (needs supabase mock)
// ============================================================
describe('DEVICE_MULTI_ACCOUNT', () => {
  function mockWith(fp, countResult) {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: (table) => {
        if (table === 'fingerprints') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: fp }),
              }),
            }),
          };
        }
        if (table === 'user_fingerprints') {
          return {
            select: () => ({
              eq: () => Promise.resolve(countResult),
            }),
          };
        }
        return {};
      },
    }));
  }

  test('关联 4 个账号 → 触发', async () => {
    mockWith({ id: 'fp1', account_count: 4 }, { count: 4, error: null });
    const { evaluate } = require('../../../../src/services/riskEngine/rules/deviceMultiAccount');
    const r = await evaluate({
      req: { abuse: { fingerprintHash: 'abc' } },
      rule: { params: { max_accounts: 3 } },
    });
    expect(r.triggered).toBe(true);
    expect(r.evidence.associated_accounts).toBe(4);
  });

  test('只关联 2 个 → 不触发', async () => {
    mockWith({ id: 'fp1', account_count: 2 }, { count: 2, error: null });
    const { evaluate } = require('../../../../src/services/riskEngine/rules/deviceMultiAccount');
    const r = await evaluate({
      req: { abuse: { fingerprintHash: 'abc' } },
      rule: { params: { max_accounts: 3 } },
    });
    expect(r.triggered).toBe(false);
  });

  test('无 fingerprintHash → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/deviceMultiAccount');
    const r = await evaluate({
      req: { abuse: {} },
      rule: { params: {} },
    });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// ASN_DATACENTER
// ============================================================
describe('ASN_DATACENTER', () => {
  test('is_datacenter=true → 触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { is_datacenter: true, asn: 14061, asn_org: 'DigitalOcean' },
            }),
          }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/asnDatacenter');
    const r = await evaluate({ req: { abuse: { ip: '1.2.3.4' } } });
    expect(r.triggered).toBe(true);
    expect(r.evidence.asn).toBe(14061);
  });
  test('家宽 IP → 不触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { is_datacenter: false } }),
          }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/asnDatacenter');
    const r = await evaluate({ req: { abuse: { ip: '1.2.3.4' } } });
    expect(r.triggered).toBe(false);
  });
  test('ip=unknown → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/asnDatacenter');
    const r = await evaluate({ req: { abuse: { ip: 'unknown' } } });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// IP_CIDR24_BURST
// ============================================================
describe('IP_CIDR24_BURST', () => {
  test('同段 1h >= 5 → 触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: (table) => {
        if (table === 'ip_records') {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: [{ id: 'ip1' }, { id: 'ip2' }],
              }),
            }),
          };
        }
        if (table === 'user_ips') {
          return {
            select: () => ({
              in: () => ({
                gte: () => Promise.resolve({
                  data: [
                    { user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' },
                    { user_id: 'u4' }, { user_id: 'u5' },
                  ],
                }),
              }),
            }),
          };
        }
      },
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/ipCidr24Burst');
    const r = await evaluate({
      action: 'register',
      req: { abuse: { ipCidr24: '1.2.3.0/24' } },
      rule: { params: { window_hours: 1, max_registrations: 5 } },
    });
    expect(r.triggered).toBe(true);
    expect(r.evidence.registrations_in_window).toBe(5);
  });

  test('非 register action → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/ipCidr24Burst');
    const r = await evaluate({
      action: 'post_create',
      req: { abuse: { ipCidr24: '1.2.3.0/24' } },
      rule: { params: {} },
    });
    expect(r.triggered).toBe(false);
  });

  test('无 ipCidr24 → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/ipCidr24Burst');
    const r = await evaluate({
      action: 'register',
      req: { abuse: {} },
      rule: { params: {} },
    });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// SIMHASH_SIMILAR（简化测试：mock supabase 返回相似内容）
// ============================================================
describe('SIMHASH_SIMILAR', () => {
  test('有相似新号帖 → 触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: (table) => {
        if (table === 'users') {
          return {
            select: () => ({
              gte: () => ({
                neq: () => ({
                  limit: () => Promise.resolve({
                    data: [{ id: 'other' }],
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'posts') {
          return {
            select: () => ({
              gte: () => ({
                in: () => ({
                  limit: () => Promise.resolve({
                    data: [
                      { id: 'p-similar', author_id: 'other', content: '今天天气真好我很开心呢' },
                    ],
                  }),
                }),
              }),
            }),
          };
        }
      },
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/simhashSimilar');
    const r = await evaluate({
      user: { id: 'u1' },
      rule: { params: { threshold_distance: 10 } },
      action: 'post_create',
      context: { post: { content: '今天天气真好我很开心' } },
    });
    expect(r.triggered).toBe(true);
    expect(r.evidence.similar_post_id).toBe('p-similar');
    expect(typeof r.evidence.simhash_distance).toBe('number');
  });

  test('内容差异大 → 不触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: (table) => {
        if (table === 'users') {
          return {
            select: () => ({
              gte: () => ({
                neq: () => ({
                  limit: () => Promise.resolve({ data: [{ id: 'other' }] }),
                }),
              }),
            }),
          };
        }
        if (table === 'posts') {
          return {
            select: () => ({
              gte: () => ({
                in: () => ({
                  limit: () => Promise.resolve({
                    data: [{ id: 'p1', author_id: 'other', content: '冰火两重天奇幻冒险故事' }],
                  }),
                }),
              }),
            }),
          };
        }
      },
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/simhashSimilar');
    const r = await evaluate({
      user: { id: 'u1' },
      rule: { params: { threshold_distance: 3 } },
      action: 'post_create',
      context: { post: { content: '今天的早餐真好吃我很满意' } },
    });
    expect(r.triggered).toBe(false);
  });

  test('无新号 → 不触发', async () => {
    jest.doMock('../../../../src/config/supabase', () => ({
      from: () => ({
        select: () => ({
          gte: () => ({
            neq: () => ({ limit: () => Promise.resolve({ data: [] }) }),
          }),
        }),
      }),
    }));
    const { evaluate } = require('../../../../src/services/riskEngine/rules/simhashSimilar');
    const r = await evaluate({
      user: { id: 'u1' }, rule: { params: {} },
      action: 'post_create', context: { post: { content: '随便写点啥' } },
    });
    expect(r.triggered).toBe(false);
  });

  test('内容过短 → 不触发', async () => {
    const { evaluate } = require('../../../../src/services/riskEngine/rules/simhashSimilar');
    const r = await evaluate({
      user: { id: 'u1' }, rule: { params: {} },
      action: 'post_create', context: { post: { content: '嗨' } },
    });
    expect(r.triggered).toBe(false);
  });
});

// ============================================================
// rules/index.js registerAll
// ============================================================
describe('rules/index registerAll', () => {
  test('registerAll 注册 12 条规则到风控引擎', async () => {
    jest.resetModules();
    // 真实加载 riskEngine，不 mock
    const engine = require('../../../../src/services/riskEngine');
    const { registerAll, mapping } = require('../../../../src/services/riskEngine/rules');
    registerAll();
    const codes = Object.keys(mapping);
    expect(codes).toHaveLength(12);
    for (const code of codes) {
      expect(engine.getRegisteredRule(code)).toBeTruthy();
    }
  });
});
