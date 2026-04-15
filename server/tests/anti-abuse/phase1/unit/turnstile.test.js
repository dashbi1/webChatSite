const { verifyTurnstileFactory } = require('../../../../src/middleware/turnstile');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe('verifyTurnstile middleware', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.TURNSTILE_ENABLED = 'true';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('TURNSTILE_ENABLED=false 直接放行', async () => {
    process.env.TURNSTILE_ENABLED = 'false';
    const mw = verifyTurnstileFactory({ fetchVerify: () => Promise.reject(new Error('should not call')) });
    const next = jest.fn();
    const res = makeRes();
    await mw({ body: {}, headers: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('缺 token → 400', async () => {
    const mw = verifyTurnstileFactory({ fetchVerify: () => Promise.resolve({ success: true }) });
    const next = jest.fn();
    const res = makeRes();
    await mw({ body: {}, headers: {} }, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/人机验证/);
    expect(next).not.toHaveBeenCalled();
  });

  test('缺 SECRET_KEY → 500', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const mw = verifyTurnstileFactory({ fetchVerify: () => Promise.resolve({ success: true }) });
    const next = jest.fn();
    const res = makeRes();
    await mw({ body: { turnstile_token: 'abc' }, headers: {} }, res, next);
    expect(res.statusCode).toBe(500);
  });

  test('CF 返回 success=true → 放行 + 记录 req.turnstile', async () => {
    const mw = verifyTurnstileFactory({
      fetchVerify: async () => ({ success: true, action: 'register' }),
    });
    const req = { body: { turnstile_token: 'ok-token' }, headers: {} };
    const res = makeRes();
    const next = jest.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.turnstile).toEqual({ success: true, action: 'register' });
  });

  test('CF 返回 success=false → 400', async () => {
    const mw = verifyTurnstileFactory({
      fetchVerify: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const next = jest.fn();
    const res = makeRes();
    await mw({ body: { turnstile_token: 'bad-token' }, headers: {} }, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/人机验证失败/);
    expect(next).not.toHaveBeenCalled();
  });

  test('fetchVerify 抛异常 → 503', async () => {
    const mw = verifyTurnstileFactory({
      fetchVerify: async () => { throw new Error('timeout'); },
    });
    const next = jest.fn();
    const res = makeRes();
    await mw({ body: { turnstile_token: 't' }, headers: {} }, res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('支持 CF-Turnstile-Response header 代替 body token', async () => {
    const mw = verifyTurnstileFactory({
      fetchVerify: async () => ({ success: true }),
    });
    const next = jest.fn();
    const res = makeRes();
    await mw({ body: {}, headers: { 'cf-turnstile-response': 'hdr-token' } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
