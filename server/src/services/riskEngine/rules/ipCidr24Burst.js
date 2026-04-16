// IP_CIDR24_BURST: 同 /24 IP 段 window_hours 内注册 >= max_registrations
const supabase = require('../../../config/supabase');

async function evaluate({ rule, req, action }) {
  // 仅在 register action 触发（其他 action 不应加分）
  if (action !== 'register') return { triggered: false };
  const cidr = req && req.abuse && req.abuse.ipCidr24;
  if (!cidr) return { triggered: false };

  const windowHours =
    (rule.params && rule.params.window_hours) || 1;
  const maxReg =
    (rule.params && rule.params.max_registrations) || 5;

  const since = new Date(
    Date.now() - windowHours * 3600 * 1000
  ).toISOString();

  // 找该 /24 段所有 ip 记录
  const { data: ipRecs } = await supabase
    .from('ip_records')
    .select('id')
    .eq('ip_cidr_24', cidr);
  if (!ipRecs || ipRecs.length === 0) return { triggered: false };
  const ipIds = ipRecs.map((r) => r.id);

  // 在 user_ips 关联中找 window 内的用户（按 first_seen_at 近似"注册时间相关的 IP"）
  const { data: links } = await supabase
    .from('user_ips')
    .select('user_id')
    .in('ip_id', ipIds)
    .gte('first_seen_at', since);
  if (!links) return { triggered: false };

  const uniqUsers = new Set(links.map((l) => l.user_id));
  if (uniqUsers.size < maxReg) return { triggered: false };

  return {
    triggered: true,
    evidence: {
      ip_cidr_24: cidr,
      registrations_in_window: uniqUsers.size,
      window_hours: windowHours,
    },
  };
}

module.exports = { evaluate };
