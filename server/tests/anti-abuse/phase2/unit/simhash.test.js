const {
  simhash,
  hammingDistance,
  toHex,
  fromHex,
  tokenize,
  normalize,
} = require('../../../../src/services/simhash');

describe('normalize', () => {
  test('去空白 + 小写', () => {
    expect(normalize('  Hello WORLD  \n')).toBe('helloworld');
  });
  test('非字符串 → ""', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(123)).toBe('');
  });
});

describe('tokenize', () => {
  test('2-gram 分词', () => {
    expect(tokenize('abcd')).toEqual(['ab', 'bc', 'cd']);
  });
  test('中文 2-gram', () => {
    expect(tokenize('今天天气好')).toEqual(['今天', '天天', '天气', '气好']);
  });
  test('空字符串 → []', () => {
    expect(tokenize('')).toEqual([]);
  });
  test('1 字符 → 保留', () => {
    expect(tokenize('a')).toEqual(['a']);
  });
});

describe('simhash + hammingDistance', () => {
  test('相同文本 → 距离 0', () => {
    const s1 = simhash('今天天气真好我很开心');
    const s2 = simhash('今天天气真好我很开心');
    expect(hammingDistance(s1, s2)).toBe(0);
  });

  test('高度相似文本 → 距离小（< 20，2-gram 对插入敏感）', () => {
    // 2-gram simhash 对"插入一个字符"较敏感（全文位移）；
    // 线上用 threshold_distance=3 足以识别完全复制粘贴，插标点会被放过是可接受的
    const s1 = simhash('今天天气真好我很开心');
    const s2 = simhash('今天天气真好，我很开心');
    const d = hammingDistance(s1, s2);
    expect(d).toBeLessThan(20);
  });

  test('完全不同文本 → 距离更大', () => {
    const s1Same = simhash('今天天气真好我很开心');
    const s2Similar = simhash('今天天气真好，我很开心');
    const s3Different = simhash('冰火两重天奇幻大冒险');
    const dSimilar = hammingDistance(s1Same, s2Similar);
    const dDifferent = hammingDistance(s1Same, s3Different);
    // 不同文本距离严格大于相似文本
    expect(dDifferent).toBeGreaterThan(dSimilar);
  });

  test('空文本 → simhash = 0n', () => {
    expect(simhash('')).toBe(0n);
  });

  test('toHex / fromHex round-trip', () => {
    const sig = simhash('hello world');
    const hex = toHex(sig);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
    expect(fromHex(hex)).toBe(sig);
  });
});
