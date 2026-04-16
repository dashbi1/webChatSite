const { shouldShadowPost } = require('../../../../src/services/enforcement/shadowBan');

describe('shadowBan.shouldShadowPost', () => {
  test('非 shadow 用户：永远 false', () => {
    expect(shouldShadowPost({ isShadowBanned: false }, 1.0)).toBe(false);
    expect(shouldShadowPost({}, 1.0)).toBe(false);
    expect(shouldShadowPost(null, 1.0)).toBe(false);
    expect(shouldShadowPost(undefined, 1.0)).toBe(false);
  });

  test('sampleRate=0：永远 false', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldShadowPost({ isShadowBanned: true }, 0)).toBe(false);
    }
  });

  test('sampleRate=1：永远 true', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldShadowPost({ isShadowBanned: true }, 1)).toBe(true);
    }
  });

  test('sampleRate=0.5 抽样率正确（1 万次误差 < 3%）', () => {
    const spy = jest.spyOn(Math, 'random');
    try {
      let hit = 0;
      const total = 10000;
      for (let i = 0; i < total; i++) {
        spy.mockReturnValueOnce(i / total); // 均匀分布 0..1
        if (shouldShadowPost({ isShadowBanned: true }, 0.5)) hit++;
      }
      const rate = hit / total;
      expect(Math.abs(rate - 0.5)).toBeLessThan(0.03);
    } finally {
      spy.mockRestore();
    }
  });

  test('sampleRate 无效值时按 0.5 处理（容错）', () => {
    // 无效值 → clamp 到 0.5
    // 抽样内部 Math.random()，这里只验证非崩溃 + 布尔返回
    expect(typeof shouldShadowPost({ isShadowBanned: true }, 'bad')).toBe('boolean');
    expect(typeof shouldShadowPost({ isShadowBanned: true }, NaN)).toBe('boolean');
  });

  test('sampleRate 超界 clamp', () => {
    for (let i = 0; i < 50; i++) {
      expect(shouldShadowPost({ isShadowBanned: true }, -1)).toBe(false);
      expect(shouldShadowPost({ isShadowBanned: true }, 5)).toBe(true);
    }
  });
});
