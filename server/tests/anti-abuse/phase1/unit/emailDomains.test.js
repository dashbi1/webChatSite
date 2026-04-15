const {
  getDomain,
  isEduDomain,
  isWhitelistedDomain,
  isColdDomain,
} = require('../../../../src/services/whitelist/emailDomains');

describe('getDomain', () => {
  test.each([
    ['a@gmail.com', 'gmail.com'],
    ['UPPER@Example.COM', 'example.com'],
    ['no-at-sign', null],
    [null, null],
    [undefined, null],
    ['', null],
  ])('getDomain(%p) → %p', (input, expected) => {
    expect(getDomain(input)).toBe(expected);
  });
});

describe('isEduDomain', () => {
  test.each([
    ['hit.edu.cn', true],
    ['mit.edu', true],
    ['sub.cs.hit.edu.cn', true],
    ['iscas.ac.cn', true],
    ['gmail.com', false],
    ['random.xyz', false],
    ['', false],
  ])('isEduDomain(%p) → %p', (d, expected) => {
    expect(isEduDomain(d)).toBe(expected);
  });
});

describe('isWhitelistedDomain', () => {
  test.each([
    ['user@gmail.com', true],
    ['user@qq.com', true],
    ['user@outlook.com', true],
    ['user@163.com', true],
    ['student@hit.edu.cn', true],
    ['admin@mit.edu', true],
    ['test@mailinator.com', false],
    ['test@random.xyz', false],
    ['test@some-temp.tk', false],
    ['not-an-email', false],
    [null, false],
  ])('isWhitelistedDomain(%p) → %p', (email, expected) => {
    expect(isWhitelistedDomain(email)).toBe(expected);
  });
});

describe('isColdDomain', () => {
  test('gmail 不冷门', () => {
    expect(isColdDomain('a@gmail.com')).toBe(false);
  });
  test('edu 不冷门', () => {
    expect(isColdDomain('a@hit.edu.cn')).toBe(false);
  });
  test('random.xyz 冷门', () => {
    expect(isColdDomain('a@random.xyz')).toBe(true);
  });
});
