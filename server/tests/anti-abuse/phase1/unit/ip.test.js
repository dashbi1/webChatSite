const { getClientIp, getClientIpCidr24, getDeployMode } = require('../../../../src/utils/ip');

function makeReq({ headers = {}, reqIp, remoteAddress } = {}) {
  return {
    headers,
    ip: reqIp,
    connection: remoteAddress ? { remoteAddress } : undefined,
  };
}

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

describe('getDeployMode', () => {
  test('未设置 → ip', () => {
    delete process.env.DEPLOY_MODE;
    expect(getDeployMode()).toBe('ip');
  });
  test('cloudflare → cloudflare', () => {
    process.env.DEPLOY_MODE = 'cloudflare';
    expect(getDeployMode()).toBe('cloudflare');
  });
  test('cloudflare-split → cloudflare', () => {
    process.env.DEPLOY_MODE = 'cloudflare-split';
    expect(getDeployMode()).toBe('cloudflare');
  });
  test('大小写不敏感', () => {
    process.env.DEPLOY_MODE = 'Cloudflare';
    expect(getDeployMode()).toBe('cloudflare');
  });
});

describe('getClientIp — ip 模式', () => {
  beforeEach(() => { process.env.DEPLOY_MODE = 'ip'; });

  test('优先取 req.ip（Express trust proxy 解析 X-Forwarded-For）', () => {
    const req = makeReq({
      headers: { 'x-real-ip': '1.2.3.4' },
      reqIp: '9.9.9.9',
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  test('req.ip 缺失时取 X-Real-IP', () => {
    const req = makeReq({ headers: { 'x-real-ip': '1.2.3.4' } });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  test('全缺失 → unknown', () => {
    expect(getClientIp(makeReq())).toBe('unknown');
  });

  test('仅 remoteAddress 也能拿到', () => {
    const req = makeReq({ remoteAddress: '10.11.12.13' });
    expect(getClientIp(req)).toBe('10.11.12.13');
  });

  test('去掉 IPv4-mapped IPv6 前缀', () => {
    const req = makeReq({ reqIp: '::ffff:192.168.1.5' });
    expect(getClientIp(req)).toBe('192.168.1.5');
  });
});

describe('getClientIp — cloudflare 模式', () => {
  beforeEach(() => { process.env.DEPLOY_MODE = 'cloudflare'; });

  test('优先取 CF-Connecting-IP（由 CF 边缘注入，比 X-Real-IP 更可信）', () => {
    const req = makeReq({
      headers: { 'cf-connecting-ip': '5.6.7.8', 'x-real-ip': '1.2.3.4' },
      reqIp: '127.0.0.1',
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  test('CF-Connecting-IP 缺失时取 req.ip', () => {
    const req = makeReq({
      headers: { 'x-real-ip': '1.2.3.4' },
      reqIp: '9.9.9.9',
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  test('仅有 X-Real-IP 时也能取到（兜底）', () => {
    const req = makeReq({ headers: { 'x-real-ip': '1.2.3.4' } });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  test('cloudflare-split 和 cloudflare 行为一致', () => {
    process.env.DEPLOY_MODE = 'cloudflare-split';
    const req = makeReq({
      headers: { 'cf-connecting-ip': '5.6.7.8' },
      reqIp: '127.0.0.1',
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });
});

describe('getClientIp — 边界', () => {
  test('非字符串值 fallback 为 unknown', () => {
    process.env.DEPLOY_MODE = 'ip';
    const req = { headers: {}, ip: 12345 };
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('getClientIpCidr24', () => {
  beforeEach(() => { process.env.DEPLOY_MODE = 'ip'; });

  test('普通 IPv4 生成 /24 段', () => {
    const req = makeReq({ reqIp: '10.20.30.40' });
    expect(getClientIpCidr24(req)).toBe('10.20.30.0/24');
  });

  test('IPv6 返回 null', () => {
    const req = makeReq({ reqIp: '2001:db8::1' });
    expect(getClientIpCidr24(req)).toBeNull();
  });

  test('unknown 返回 null', () => {
    expect(getClientIpCidr24(makeReq())).toBeNull();
  });

  test('IPv4-mapped IPv6 前缀处理后生成 /24', () => {
    const req = makeReq({ reqIp: '::ffff:8.8.8.8' });
    expect(getClientIpCidr24(req)).toBe('8.8.8.0/24');
  });
});
