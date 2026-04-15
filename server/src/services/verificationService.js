// 邮箱验证码生成、校验、限流
// 存储在 PostgreSQL 的 email_verifications 表（通过 supabase 客户端访问）

const supabase = require('../config/supabase');

const CODE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const RESEND_COOLDOWN_MS = 60 * 1000; // 同邮箱 60 秒内只能发 1 次

/**
 * 创建一个新验证码，返回验证码字符串。
 * 如果 60 秒内已发过，抛出 Error(code='RATE_LIMITED')。
 */
async function createCode(email, purpose) {
  const { data: last } = await supabase
    .from('email_verifications')
    .select('created_at')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last) {
    const elapsedMs = Date.now() - new Date(last.created_at).getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      const secondsLeft = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      const err = new Error(`请 ${secondsLeft} 秒后再试`);
      err.code = 'RATE_LIMITED';
      throw err;
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error } = await supabase
    .from('email_verifications')
    .insert({ email, code, purpose, expires_at: expiresAt });

  if (error) {
    throw new Error('验证码创建失败');
  }
  return code;
}

/**
 * 校验验证码。校验成功会标记为已使用（一次性）。
 * 返回 { ok: true } 或 { ok: false, reason: '...' }
 */
async function verifyCode(email, code, purpose) {
  const { data } = await supabase
    .from('email_verifications')
    .select('id, code, expires_at, used_at')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { ok: false, reason: '验证码不存在，请先获取' };
  if (data.used_at) return { ok: false, reason: '验证码已使用，请重新获取' };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: '验证码已过期，请重新获取' };
  }
  if (data.code !== code) return { ok: false, reason: '验证码不正确' };

  await supabase
    .from('email_verifications')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { ok: true };
}

module.exports = { createCode, verifyCode };
