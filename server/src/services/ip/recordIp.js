// Upsert ip_records + user_ips 多对多；首次见到或 enriched_at 过期时再调 ip-api 补 ASN
//
// 缓存策略：enriched_at 存 DB，再见同 IP 只要 < 7 天就不重复调 ip-api

const supabase = require('../../config/supabase');
const { enrichIp } = require('./enrichIp');

const ENRICH_TTL_DAYS = 7;

function cidr24Of(ip) {
  if (!ip || typeof ip !== 'string' || ip.includes(':')) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * @returns {Promise<{present:boolean, ip?:string, id?:string}>}
 */
async function recordIp(ipAddress, userId, options = {}) {
  if (!ipAddress || ipAddress === 'unknown') return { present: false };

  const cidr = cidr24Of(ipAddress);

  try {
    // 1. 查现有记录，决定是否需要 enrich
    const { data: existing } = await supabase
      .from('ip_records')
      .select('id, enriched_at')
      .eq('ip_address', ipAddress)
      .maybeSingle();

    const nowMs = Date.now();
    const ttlMs = ENRICH_TTL_DAYS * 86400 * 1000;
    const needsEnrich =
      !existing ||
      !existing.enriched_at ||
      nowMs - new Date(existing.enriched_at).getTime() > ttlMs;

    let enriched = {};
    if (needsEnrich) {
      // ip-api 调用（失败不影响，仅 is_datacenter=false）
      enriched = await enrichIp(ipAddress, options);
    }

    // 2. Upsert
    const payload = {
      ip_address: ipAddress,
      ip_cidr_24: cidr,
      last_seen_at: new Date().toISOString(),
    };
    if (needsEnrich) {
      payload.asn = enriched.asn ?? null;
      payload.asn_org = enriched.asn_org ?? null;
      payload.country = enriched.country ?? null;
      payload.is_datacenter = Boolean(enriched.is_datacenter);
      payload.enriched_at = new Date().toISOString();
    }

    const { data: rec, error } = await supabase
      .from('ip_records')
      .upsert(payload, { onConflict: 'ip_address' })
      .select('id')
      .single();
    if (error || !rec) {
      console.warn('[recordIp] upsert failed:', error && error.message);
      return { present: true, ip: ipAddress };
    }

    // 3. 关联到用户
    if (userId) {
      const { error: linkErr } = await supabase
        .from('user_ips')
        .upsert(
          {
            user_id: userId,
            ip_id: rec.id,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,ip_id' }
        );
      if (linkErr) {
        console.warn('[recordIp] link failed:', linkErr.message);
      }
    }

    return { present: true, ip: ipAddress, id: rec.id };
  } catch (err) {
    console.warn('[recordIp] error:', err && err.message);
    return { present: true, ip: ipAddress };
  }
}

module.exports = { recordIp, cidr24Of };
