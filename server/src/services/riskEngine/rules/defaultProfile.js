// DEFAULT_PROFILE: 头像空 + 默认昵称格式（"用户xxx"）
async function evaluate({ user, rule, action }) {
  if (action !== 'register') return { triggered: false };
  const pattern =
    (rule.params && rule.params.default_nickname_pattern) ||
    '^用户[\\w]{4,8}$';

  const nickname = user.nickname || '';
  const avatar = user.avatar_url || '';

  let re;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    return { triggered: false };
  }

  const hasDefaultNick = re.test(nickname);
  const noAvatar = !avatar || avatar.length === 0;
  if (!hasDefaultNick || !noAvatar) return { triggered: false };

  return {
    triggered: true,
    evidence: { nickname },
  };
}

module.exports = { evaluate };
