// 邮箱白名单（永不被风控封禁，但可降权观察）
// 详见 docs/anti-abuse/02-rules-and-scoring.md 第 4 节

const WHITELIST = new Set([
  // 国际大厂
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.cn',
  'icloud.com',
  'me.com',
  // 国内大厂
  'qq.com',
  '163.com',
  '126.com',
  'foxmail.com',
  'sina.com',
  'sina.cn',
  'vip.qq.com',
  '139.com',
]);

function getDomain(email) {
  if (typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

// 学校邮箱：*.edu / *.edu.cn / *.ac.cn（部分研究所）
function isEduDomain(domain) {
  if (!domain) return false;
  return (
    domain === 'edu' ||
    domain === 'edu.cn' ||
    domain.endsWith('.edu') ||
    domain.endsWith('.edu.cn') ||
    domain.endsWith('.ac.cn')
  );
}

// 全白名单判定（用于豁免封禁）
function isWhitelistedDomain(email) {
  const d = getDomain(email);
  if (!d) return false;
  return WHITELIST.has(d) || isEduDomain(d);
}

// 冷门判定（用于 COLD_EMAIL_DOMAIN 规则）
// 冷门 = 不在白名单 且 不是 edu 域
function isColdDomain(email) {
  return !isWhitelistedDomain(email);
}

module.exports = {
  WHITELIST,
  getDomain,
  isEduDomain,
  isWhitelistedDomain,
  isColdDomain,
};
