// Phase 3 ban_records 写入 + 级联动作
//
// createBanRecord({ targetType, targetId, banType, reason, expiresAt, createdBy }):
//   - 插 ban_records
//   - 若 targetType='user'：级联更新 users.status='banned'
//   - 若 targetType='fingerprint'：级联更新 fingerprints.is_banned=true
//   - 若 targetType='ip'：级联更新 ip_records.is_banned=true（按 ip_cidr_24 或 ip_address 匹配）

const supabase = require('../../config/supabase');

/**
 * @param {Object} params
 * @param {'user'|'fingerprint'|'ip'} params.targetType
 * @param {string} params.targetId
 * @param {string} params.banType
 * @param {string} params.reason
 * @param {string|null} [params.expiresAt] ISO timestamp
 * @param {string|null} [params.createdBy] admin user id
 */
async function createBanRecord({
  targetType,
  targetId,
  banType,
  reason,
  expiresAt = null,
  createdBy = null,
}) {
  if (!targetType || !targetId || !banType || !reason) {
    throw new Error('createBanRecord: missing required fields');
  }

  const { data: inserted, error } = await supabase
    .from('ban_records')
    .insert({
      target_type: targetType,
      target_id: String(targetId),
      ban_type: banType,
      reason,
      expires_at: expiresAt,
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`createBanRecord insert failed: ${error.message}`);
  }

  // 级联副作用
  try {
    if (targetType === 'user') {
      await supabase.from('users').update({ status: 'banned' }).eq('id', targetId);
    } else if (targetType === 'fingerprint') {
      await supabase
        .from('fingerprints')
        .update({
          is_banned: true,
          banned_until: expiresAt,
          banned_reason: reason,
          banned_at: new Date().toISOString(),
          banned_by: createdBy,
        })
        .eq('id', targetId);
    } else if (targetType === 'ip') {
      // target_id 可能是 ip_address 或 cidr 字符串
      if (String(targetId).includes('/')) {
        // CIDR → 按 ip_cidr_24 批量改
        await supabase
          .from('ip_records')
          .update({
            is_banned: true,
            banned_until: expiresAt,
            banned_reason: reason,
          })
          .eq('ip_cidr_24', targetId);
      } else {
        await supabase
          .from('ip_records')
          .update({
            is_banned: true,
            banned_until: expiresAt,
            banned_reason: reason,
          })
          .eq('ip_address', targetId);
      }
    }
  } catch (e) {
    console.warn('[banRecord] cascade update failed:', e && e.message);
  }

  return inserted;
}

/**
 * 撤销封禁：写 revoked_at 并清除目标的 is_banned / status
 */
async function revokeBanRecord(banId, revokedBy, revokeReason = null) {
  const { data: record, error: readErr } = await supabase
    .from('ban_records')
    .select('*')
    .eq('id', banId)
    .maybeSingle();
  if (readErr || !record) throw new Error('ban record not found');
  if (record.revoked_at) return record; // 已撤销

  const { error: updErr } = await supabase
    .from('ban_records')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy,
      revoke_reason: revokeReason,
    })
    .eq('id', banId);
  if (updErr) throw new Error(`revoke failed: ${updErr.message}`);

  // 反向级联（仅当目标上无其他活跃封禁时）
  try {
    const { data: otherActive } = await supabase
      .from('ban_records')
      .select('id')
      .eq('target_type', record.target_type)
      .eq('target_id', record.target_id)
      .is('revoked_at', null)
      .neq('id', banId)
      .limit(1);
    if (!otherActive || otherActive.length === 0) {
      if (record.target_type === 'user') {
        await supabase.from('users').update({ status: 'active' }).eq('id', record.target_id);
      } else if (record.target_type === 'fingerprint') {
        await supabase
          .from('fingerprints')
          .update({ is_banned: false, banned_until: null })
          .eq('id', record.target_id);
      } else if (record.target_type === 'ip') {
        const col = String(record.target_id).includes('/') ? 'ip_cidr_24' : 'ip_address';
        await supabase
          .from('ip_records')
          .update({ is_banned: false, banned_until: null })
          .eq(col, record.target_id);
      }
    }
  } catch (e) {
    console.warn('[banRecord] revoke cascade failed:', e && e.message);
  }

  return { ...record, revoked_at: new Date().toISOString() };
}

module.exports = { createBanRecord, revokeBanRecord };
