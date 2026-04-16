// Phase 3 申诉服务：提交 + 查列表 + 管理员处理 + 7 天 3 次限流 + feature flag
// feature flag: system_config.appeals_enabled（默认 false）
// 限流：一账号 7 天最多 3 次

const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');

const APPEAL_WINDOW_DAYS = 7;
const APPEAL_MAX_IN_WINDOW = 3;

class AppealError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * 提交申诉
 * @param {string} userId
 * @param {{ contact_email: string, reason: string, evidence_urls?: string[] }} dto
 * @returns {Promise<Object>} 插入的 appeal 记录
 * @throws AppealError
 */
async function submitAppeal(userId, dto) {
  const enabled = await getSystemConfig('appeals_enabled', false);
  if (!enabled) {
    throw new AppealError('COMING_SOON', '申诉功能正在开发中，敬请期待', 503);
  }
  if (!dto || typeof dto.reason !== 'string' || dto.reason.trim().length < 10) {
    throw new AppealError('REASON_TOO_SHORT', '请详细描述申诉理由（至少 10 字）', 400);
  }
  if (!dto.contact_email || typeof dto.contact_email !== 'string') {
    throw new AppealError('EMAIL_REQUIRED', '请填写联系邮箱', 400);
  }

  // 7 天 3 次限流
  const since = new Date(Date.now() - APPEAL_WINDOW_DAYS * 86400 * 1000).toISOString();
  const { count, error: countErr } = await supabase
    .from('appeals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  if (countErr) {
    throw new AppealError('INTERNAL', '限流检查失败', 500);
  }
  if (typeof count === 'number' && count >= APPEAL_MAX_IN_WINDOW) {
    throw new AppealError('RATE_LIMITED', `${APPEAL_WINDOW_DAYS} 天内申诉次数已达上限`, 429);
  }

  const payload = {
    user_id: userId,
    contact_email: dto.contact_email.trim(),
    reason: dto.reason.trim(),
    evidence_urls: Array.isArray(dto.evidence_urls) ? dto.evidence_urls : [],
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('appeals')
    .insert(payload)
    .select('*')
    .single();
  if (insertErr) {
    throw new AppealError('INTERNAL', '提交申诉失败', 500);
  }
  return inserted;
}

/**
 * 查询自己的申诉历史
 */
async function getUserAppeals(userId) {
  const { data, error } = await supabase
    .from('appeals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

/**
 * 管理员：列出 pending 申诉
 */
async function listPending({ limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('appeals')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return [];
  return data || [];
}

/**
 * 管理员：批准 / 拒绝申诉
 * 批准时自动 -30 风险分 + 解除封禁 + 写 risk_events
 */
async function resolveAppeal(appealId, adminId, status, note = null) {
  if (!['approved', 'rejected'].includes(status)) {
    throw new AppealError('INVALID_STATUS', 'status 必须是 approved 或 rejected', 400);
  }

  const { data: appeal, error: readErr } = await supabase
    .from('appeals')
    .select('*')
    .eq('id', appealId)
    .maybeSingle();
  if (readErr || !appeal) {
    throw new AppealError('NOT_FOUND', '申诉不存在', 404);
  }
  if (appeal.status !== 'pending') {
    throw new AppealError('ALREADY_RESOLVED', '该申诉已处理', 409);
  }

  const { data: updated, error: updErr } = await supabase
    .from('appeals')
    .update({
      status,
      admin_note: note,
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
    })
    .eq('id', appealId)
    .select('*')
    .single();
  if (updErr) {
    throw new AppealError('INTERNAL', '处理失败', 500);
  }

  // 批准则减 30 分 + 解封
  if (status === 'approved') {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('id, risk_score, status')
        .eq('id', appeal.user_id)
        .maybeSingle();
      if (user) {
        const newScore = Math.max(0, (user.risk_score || 0) - 30);
        const patch = {
          risk_score: newScore,
          restricted_until: null,
          is_shadow_banned: false,
          shadow_ban_until: null,
        };
        if (user.status === 'banned') patch.status = 'active';
        await supabase.from('users').update(patch).eq('id', appeal.user_id);

        await supabase.from('risk_events').insert({
          user_id: appeal.user_id,
          rule_code: 'APPEAL_APPROVE',
          score_delta: newScore - (user.risk_score || 0),
          reason: 'appeal_approve',
          evidence: { appeal_id: appealId, admin_id: adminId, note },
          mode: 'enforce',
        });
      }
    } catch (e) {
      console.warn('[appealService] approve cascade failed:', e && e.message);
    }
  }

  return updated;
}

module.exports = {
  submitAppeal,
  getUserAppeals,
  listPending,
  resolveAppeal,
  AppealError,
  APPEAL_WINDOW_DAYS,
  APPEAL_MAX_IN_WINDOW,
};
