// COLD_EMAIL_DOMAIN: 邮箱域名不在白名单且非 edu
const {
  isWhitelistedDomain,
  getDomain,
} = require('../../whitelist/emailDomains');

async function evaluate({ user, action }) {
  // 只在注册时评估（避免对老用户每次动作都加分）
  if (action !== 'register') return { triggered: false };
  if (!user.email) return { triggered: false };
  if (isWhitelistedDomain(user.email)) return { triggered: false };

  return {
    triggered: true,
    evidence: { domain: getDomain(user.email) },
  };
}

module.exports = { evaluate };
