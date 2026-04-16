// Phase 3 Cron：IP /24 段注册密集度检测
// 每 10 分钟扫描一次：1h 内同 /24 段注册账号数 >= 5 → 临时封段 15 分钟
//
// 幂等：检查是否已有活跃 ban_records(ip + cidr)，若存在则跳过

const supabase = require('../config/supabase');
const { createBanRecord } = require('../services/enforcement/banRecord');

const WINDOW_HOURS = 1;
const MIN_ACCOUNTS = 5;
const BAN_DURATION_MS = 15 * 60 * 1000;

async function hasActiveIpCidrBan(ipCidr24) {
  const { data } = await supabase
    .from('ban_records')
    .select('id')
    .eq('target_type', 'ip')
    .eq('target_id', String(ipCidr24))
    .is('revoked_at', null)
    .gte('expires_at', new Date().toISOString())
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

/**
 * 单次扫描：返回本次新封段数组
 */
async function runIpBurstCheck() {
  const { data: bursts, error } = await supabase.rpc('find_burst_ip_cidr24', {
    p_window_hours: WINDOW_HOURS,
    p_min: MIN_ACCOUNTS,
  });
  if (error) {
    console.warn('[ipBurstCheck] RPC error:', error.message);
    return { checked: 0, banned: 0, skipped: 0 };
  }

  const rows = bursts || [];
  let banned = 0;
  let skipped = 0;

  for (const row of rows) {
    const cidr = row.ip_cidr_24;
    if (!cidr) continue;
    const cidrStr = String(cidr);
    // 幂等
    if (await hasActiveIpCidrBan(cidrStr)) {
      skipped++;
      continue;
    }

    const expires = new Date(Date.now() + BAN_DURATION_MS).toISOString();
    try {
      await createBanRecord({
        targetType: 'ip',
        targetId: cidrStr,
        banType: 'ip_burst_auto',
        reason: `${WINDOW_HOURS}h 内同段注册 ${row.account_count} 个账号`,
        expiresAt: expires,
        createdBy: null,
      });
      banned++;
    } catch (e) {
      console.warn('[ipBurstCheck] createBanRecord failed for', cidrStr, e && e.message);
    }
  }

  return { checked: rows.length, banned, skipped };
}

module.exports = { runIpBurstCheck, WINDOW_HOURS, MIN_ACCOUNTS, BAN_DURATION_MS };
