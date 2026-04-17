// Phase 4：过期封禁自动解除（每日 04:30 cron 调）
//
// 扫描 ban_records 里 expires_at <= now AND revoked_at IS NULL 的记录，
//   - 标 revoked_at = now, revoke_reason = 'auto_expired'
//   - 同步更新 target_type 对应的资源：
//     * user：如果 status='banned' 且 risk_score<85 → 恢复 active（高风险仍保留，等衰减）
//     * fingerprint：is_banned=false, banned_until=null
//     * ip：is_banned=false, banned_until=null
//
// 永久封禁（expires_at IS NULL）不处理 —— 仅靠申诉通过或 admin 手动解除。

const supabase = require('../../config/supabase');

async function runExpireBans(now = new Date()) {
  const nowIso = now.toISOString();
  const summary = {
    scanned: 0,
    revoked: 0,
    user: 0,
    fingerprint: 0,
    ip: 0,
    errors: 0,
  };

  const { data: rows, error } = await supabase
    .from('ban_records')
    .select('id, target_type, target_id, expires_at')
    .lte('expires_at', nowIso)
    .is('revoked_at', null)
    .limit(1000);
  if (error) {
    console.warn('[expireBans] list failed:', error.message);
    summary.errors++;
    return summary;
  }

  summary.scanned = (rows || []).length;

  for (const r of rows || []) {
    try {
      const { error: updErr } = await supabase
        .from('ban_records')
        .update({ revoked_at: nowIso, revoke_reason: 'auto_expired' })
        .eq('id', r.id);
      if (updErr) {
        summary.errors++;
        continue;
      }
      summary.revoked++;

      if (r.target_type === 'user') {
        const { data: u } = await supabase
          .from('users')
          .select('id, status, risk_score')
          .eq('id', r.target_id)
          .maybeSingle();
        if (u && u.status === 'banned' && (u.risk_score || 0) < 85) {
          await supabase.from('users').update({ status: 'active' }).eq('id', r.target_id);
        }
        summary.user++;
      } else if (r.target_type === 'fingerprint') {
        await supabase
          .from('fingerprints')
          .update({ is_banned: false, banned_until: null })
          .eq('id', r.target_id);
        summary.fingerprint++;
      } else if (r.target_type === 'ip') {
        await supabase
          .from('ip_records')
          .update({ is_banned: false, banned_until: null })
          .eq('ip_address', r.target_id);
        summary.ip++;
      }
    } catch (err) {
      console.warn('[expireBans] row failed', r.id, err && err.message);
      summary.errors++;
    }
  }

  return summary;
}

module.exports = { runExpireBans };
