const crypto = require('crypto');

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function buildHeader(sigSha256, timestamp, secret, userId = '') {
  const payload = `${sigSha256}|${timestamp}|${userId}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${sigSha256}|${timestamp}|${hmac}`;
}

function makeReqRes(headers = {}, user = null) {
  const req = { headers, user };
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return { req, res };
}

describe('apkSignatureCheck', () => {
  const SIG = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  const SECRET = 'my-hmac-secret-32-byte-long-random';

  function loadMw() {
    return require('../../../../src/middleware/apkSignature').apkSignatureCheck;
  }

  test('无 X-App-Signature → absent，直接 next()', () => {
    const mw = loadMw();
    const { req, res } = makeReqRes({});
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('absent');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('格式错误（部分数 != 3） → bad_format', () => {
    const mw = loadMw();
    const { req, res } = makeReqRes({ 'x-app-signature': 'only|two' });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('bad_format');
    expect(next).toHaveBeenCalled();
  });

  test('时间戳过旧 → expired', () => {
    process.env.ALLOWED_APK_SIGNATURES = SIG;
    process.env.APK_HMAC_SECRET = SECRET;
    const mw = loadMw();
    const staleTs = Math.floor(Date.now() / 1000) - 10 * 60; // 10 分钟前
    const h = buildHeader(SIG, staleTs, SECRET);
    const { req, res } = makeReqRes({ 'x-app-signature': h });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('expired');
  });

  test('签名不在白名单 → sig_mismatch', () => {
    process.env.ALLOWED_APK_SIGNATURES =
      '0000000000000000000000000000000000000000000000000000000000000000';
    process.env.APK_HMAC_SECRET = SECRET;
    const mw = loadMw();
    const ts = Math.floor(Date.now() / 1000);
    const h = buildHeader(SIG, ts, SECRET);
    const { req, res } = makeReqRes({ 'x-app-signature': h });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('sig_mismatch');
  });

  test('HMAC 不匹配（密钥错） → hmac_mismatch', () => {
    process.env.ALLOWED_APK_SIGNATURES = SIG;
    process.env.APK_HMAC_SECRET = 'different-secret';
    const mw = loadMw();
    const ts = Math.floor(Date.now() / 1000);
    const h = buildHeader(SIG, ts, SECRET); // 用 SECRET 签的 header
    const { req, res } = makeReqRes({ 'x-app-signature': h });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('hmac_mismatch');
  });

  test('合法签名 + 密钥 + userId → valid', () => {
    process.env.ALLOWED_APK_SIGNATURES = SIG;
    process.env.APK_HMAC_SECRET = SECRET;
    const mw = loadMw();
    const ts = Math.floor(Date.now() / 1000);
    const userId = 'user-uuid-123';
    const h = buildHeader(SIG, ts, SECRET, userId);
    const { req, res } = makeReqRes({ 'x-app-signature': h }, { id: userId });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('valid');
  });

  test('多密钥兼容（旧密钥过渡期）', () => {
    const OLD_SECRET = 'old-secret-for-transition';
    process.env.ALLOWED_APK_SIGNATURES = SIG;
    process.env.APK_HMAC_SECRETS = `new-primary,${OLD_SECRET}`;
    const mw = loadMw();
    const ts = Math.floor(Date.now() / 1000);
    const h = buildHeader(SIG, ts, OLD_SECRET);
    const { req, res } = makeReqRes({ 'x-app-signature': h });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('valid');
  });

  test('未配置 HMAC 密钥 → hmac_mismatch（防漏填）', () => {
    process.env.ALLOWED_APK_SIGNATURES = SIG;
    delete process.env.APK_HMAC_SECRET;
    delete process.env.APK_HMAC_SECRETS;
    const mw = loadMw();
    const ts = Math.floor(Date.now() / 1000);
    const h = buildHeader(SIG, ts, 'anything');
    const { req, res } = makeReqRes({ 'x-app-signature': h });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('hmac_mismatch');
  });

  test('白名单支持带冒号 + 大小写', () => {
    process.env.ALLOWED_APK_SIGNATURES = 'AB:CD:EF:' + SIG.slice(6).toUpperCase();
    process.env.APK_HMAC_SECRET = SECRET;
    const mw = loadMw();
    const ts = Math.floor(Date.now() / 1000);
    const h = buildHeader(SIG, ts, SECRET);
    const { req, res } = makeReqRes({ 'x-app-signature': h });
    const next = jest.fn();
    mw(req, res, next);
    expect(req.apkSignatureStatus).toBe('valid');
  });
});
