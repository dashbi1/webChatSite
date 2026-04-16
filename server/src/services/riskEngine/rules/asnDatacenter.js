// ASN_DATACENTER: 当前 IP 属于机房 / 代理 / VPN
const supabase = require('../../../config/supabase');

async function evaluate({ req }) {
  const ip = req && req.abuse && req.abuse.ip;
  if (!ip || ip === 'unknown') return { triggered: false };

  const { data: rec } = await supabase
    .from('ip_records')
    .select('is_datacenter, asn_org, asn')
    .eq('ip_address', ip)
    .maybeSingle();
  if (!rec || !rec.is_datacenter) return { triggered: false };

  return {
    triggered: true,
    evidence: {
      ip,
      asn: rec.asn,
      asn_org: rec.asn_org,
    },
  };
}

module.exports = { evaluate };
