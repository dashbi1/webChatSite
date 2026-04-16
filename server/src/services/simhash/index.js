// Simhash 实现（64-bit，适合中文短文本）
// 算法：charlikar simhash (Moses Charikar 2002)
//   1. 文本 → 2-gram token 列表
//   2. 每个 token → MD5 → 前 8 字节 64-bit hash
//   3. 按位累加（bit=1 时 +1，bit=0 时 -1）
//   4. 每位按正负转回 0/1
//
// Hamming 距离 = 两个 simhash 异或后的 popcount
// 通常认为距离 < 3 即高度相似

const crypto = require('crypto');

function normalize(text) {
  if (typeof text !== 'string') return '';
  // 统一小写 + 去掉所有空白
  return text.toLowerCase().replace(/\s+/g, '');
}

function tokenize(text) {
  const s = normalize(text);
  if (s.length < 2) return s ? [s] : [];
  const out = [];
  for (let i = 0; i < s.length - 1; i++) {
    out.push(s.slice(i, i + 2));
  }
  return out;
}

function hash64(token) {
  const buf = crypto.createHash('md5').update(token, 'utf8').digest();
  // 前 8 字节为 64-bit unsigned 整数（BigInt）
  return buf.readBigUInt64BE(0);
}

/**
 * @param {string} text
 * @returns {BigInt} 64-bit simhash
 */
function simhash(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0n;
  const bits = new Array(64).fill(0);
  for (const t of tokens) {
    const h = hash64(t);
    for (let i = 0; i < 64; i++) {
      if ((h >> BigInt(63 - i)) & 1n) bits[i] += 1;
      else bits[i] -= 1;
    }
  }
  let sig = 0n;
  for (let i = 0; i < 64; i++) {
    if (bits[i] > 0) sig |= 1n << BigInt(63 - i);
  }
  return sig;
}

function hammingDistance(a, b) {
  let x = BigInt(a) ^ BigInt(b);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

// 方便存储 / 日志：转 16 进制 0-padded
function toHex(sig) {
  return BigInt(sig).toString(16).padStart(16, '0');
}
function fromHex(hex) {
  return BigInt('0x' + hex);
}

module.exports = { simhash, hammingDistance, toHex, fromHex, tokenize, normalize };
