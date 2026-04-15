const {
  parseDetailsHeader,
  inferPlatform,
} = require('../../../../src/services/fingerprint/recordFingerprint');

describe('parseDetailsHeader', () => {
  test('空值 → {}', () => {
    expect(parseDetailsHeader('')).toEqual({});
    expect(parseDetailsHeader(null)).toEqual({});
    expect(parseDetailsHeader(undefined)).toEqual({});
  });

  test('合法 base64 JSON → 对象', () => {
    const obj = { ua: 'Mozilla', screen: '1920x1080' };
    const b64 = Buffer.from(JSON.stringify(obj)).toString('base64');
    expect(parseDetailsHeader(b64)).toEqual(obj);
  });

  test('非 base64 / 非 JSON → {}', () => {
    expect(parseDetailsHeader('not-base64!!')).toEqual({});
    const notJson = Buffer.from('hello').toString('base64');
    expect(parseDetailsHeader(notJson)).toEqual({});
  });

  test('返回非对象类型（字符串/数字） → {}', () => {
    const b64 = Buffer.from('"just a string"').toString('base64');
    expect(parseDetailsHeader(b64)).toEqual({});
  });
});

describe('inferPlatform', () => {
  test('有 X-App-Signature → android', () => {
    expect(
      inferPlatform({ headers: { 'x-app-signature': 'abc|123|def' } })
    ).toBe('android');
  });

  test('iPhone UA → ios', () => {
    expect(
      inferPlatform({
        headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS)...' },
      })
    ).toBe('ios');
  });

  test('Android UA → android', () => {
    expect(
      inferPlatform({ headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 10)...' } })
    ).toBe('android');
  });

  test('Chrome UA → web', () => {
    expect(
      inferPlatform({
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/147' },
      })
    ).toBe('web');
  });

  test('无 UA → web（默认）', () => {
    expect(inferPlatform({ headers: {} })).toBe('web');
  });
});
