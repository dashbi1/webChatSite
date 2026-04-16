// DEVICE_MULTI_ACCOUNT: 同设备指纹关联 >= max_accounts 个账号
const supabase = require('../../../config/supabase');

async function evaluate({ user, rule, req }) {
  const fingerprintHash =
    req && req.abuse && req.abuse.fingerprintHash;
  if (!fingerprintHash) return { triggered: false };

  const max = (rule.params && rule.params.max_accounts) || 3;

  // 取指纹记录
  const { data: fp } = await supabase
    .from('fingerprints')
    .select('id, account_count')
    .eq('fingerprint_hash', fingerprintHash)
    .maybeSingle();
  if (!fp) return { triggered: false };

  // account_count 是 cron 维护的；为了实时，直接查 user_fingerprints
  const { count, error } = await supabase
    .from('user_fingerprints')
    .select('user_id', { count: 'exact', head: true })
    .eq('fingerprint_id', fp.id);
  if (error) return { triggered: false };
  if (!count || count < max) return { triggered: false };

  return {
    triggered: true,
    evidence: {
      fingerprint_id: fp.id,
      associated_accounts: count,
    },
  };
}

module.exports = { evaluate };
