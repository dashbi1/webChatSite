const { cidr24Of } = require('../../../../src/services/ip/recordIp');

describe('cidr24Of', () => {
  test.each([
    ['10.20.30.40', '10.20.30.0/24'],
    ['192.168.1.1', '192.168.1.0/24'],
    ['8.8.8.8', '8.8.8.0/24'],
    ['2001:db8::1', null],
    ['unknown', null],
    ['', null],
    [null, null],
    [undefined, null],
    ['not.an.ip', null],
    ['1.2.3', null],
  ])('cidr24Of(%p) → %p', (ip, expected) => {
    expect(cidr24Of(ip)).toBe(expected);
  });
});
