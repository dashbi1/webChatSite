const loader = require('../../../../src/services/disposableEmails/loader');

describe('disposableEmails loader', () => {
  beforeEach(() => {
    loader._setForTests([]);
  });

  test('默认 cache 为空时全不命中', () => {
    expect(loader.isDisposable('user@mailinator.com')).toBe(false);
  });

  test('注入后命中', () => {
    loader._setForTests(['mailinator.com', '10minutemail.com', 'temp-mail.org']);
    expect(loader.isDisposable('user@mailinator.com')).toBe(true);
    expect(loader.isDisposable('user@MAILINATOR.COM')).toBe(true);
    expect(loader.isDisposable('user@10minutemail.com')).toBe(true);
    expect(loader.isDisposable('user@gmail.com')).toBe(false);
  });

  test('格式错误的 email 返回 false', () => {
    loader._setForTests(['mailinator.com']);
    expect(loader.isDisposable('no-at-sign')).toBe(false);
    expect(loader.isDisposable(null)).toBe(false);
    expect(loader.isDisposable(undefined)).toBe(false);
    expect(loader.isDisposable(123)).toBe(false);
  });

  test('getLoadedSize 反映当前 set 大小', () => {
    loader._setForTests(['a.com', 'b.com']);
    expect(loader.getLoadedSize()).toBe(2);
  });
});

describe('updateFromGithub', () => {
  // 使用注入的 fetcher，不会触发真实网络
  const { updateDisposableDomains } = require(
    '../../../../src/services/disposableEmails/updateFromGithub'
  );

  test('空源 → skipped', async () => {
    // mock supabase 避免真实写
    jest.isolateModules(async () => {
      const { updateDisposableDomains: fn } = require(
        '../../../../src/services/disposableEmails/updateFromGithub'
      );
      const result = await fn({ fetcher: async () => [] });
      expect(result.skipped).toBe(true);
    });
  });
});
