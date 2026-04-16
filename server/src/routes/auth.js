const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { sendVerificationEmail } = require('../services/emailService');
const { createCode, verifyCode } = require('../services/verificationService');
const {
  rateLimitSendCode,
  rateLimitRegister,
  rateLimitResetPassword,
} = require('../middleware/rateLimit');
const { verifyTurnstile } = require('../middleware/turnstile');
const {
  isWhitelistedDomain,
} = require('../services/whitelist/emailDomains');
const {
  isDisposable,
} = require('../services/disposableEmails/loader');
const { apkSignatureCheck } = require('../middleware/apkSignature');
const { recordFingerprint } = require('../services/fingerprint/recordFingerprint');
const { recordIp } = require('../services/ip/recordIp');
const { triggerRiskEval, ensureAbuse } = require('../services/riskEngine/triggerAsync');
const { getClientIp } = require('../utils/ip');

const router = express.Router();

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const VALID_PURPOSES = new Set(['register', 'reset']);

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

// 一次性邮箱拦截：白名单邮箱永远放行，即便在 disposable 库里也放行。
function rejectDisposable(req, res, next) {
  const email = req.body && req.body.email;
  if (!email) return next();
  if (isWhitelistedDomain(email)) return next();
  if (isDisposable(email)) {
    return res
      .status(400)
      .json({ success: false, error: '请使用常用邮箱' });
  }
  next();
}

// 发送验证码（限流 → Turnstile → 一次性邮箱黑名单 → 业务）
router.post(
  '/send-code',
  rateLimitSendCode(),
  verifyTurnstile,
  rejectDisposable,
  async (req, res) => {
  const { email, purpose } = req.body;

  if (!validateEmail(email)) {
    return res.status(400).json({ success: false, error: '邮箱格式不正确' });
  }
  if (!VALID_PURPOSES.has(purpose)) {
    return res.status(400).json({ success: false, error: 'purpose 参数无效' });
  }

  // register 模式：邮箱已注册则拒绝
  // reset 模式：邮箱不存在则拒绝
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (purpose === 'register' && existing) {
    return res.status(400).json({ success: false, error: '该邮箱已注册' });
  }
  if (purpose === 'reset' && !existing) {
    return res.status(400).json({ success: false, error: '该邮箱未注册' });
  }

  let code;
  try {
    code = await createCode(email, purpose);
  } catch (err) {
    if (err.code === 'RATE_LIMITED') {
      return res.status(429).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: '验证码生成失败' });
  }

  try {
    await sendVerificationEmail(email, code, purpose);
  } catch (err) {
    console.error('[send-code] 邮件发送失败:', err.message);
    return res.status(500).json({ success: false, error: '邮件发送失败，请稍后重试' });
  }

  res.json({ success: true, message: '验证码已发送到你的邮箱' });
  }
);

// 注册（限流 + APK 签名校验 + 反滥用指纹/IP 记录）
router.post('/register', rateLimitRegister(), apkSignatureCheck, async (req, res) => {
  const { email, code, password, nickname } = req.body;

  if (!validateEmail(email)) {
    return res.status(400).json({ success: false, error: '邮箱格式不正确' });
  }
  if (!code || !password) {
    return res.status(400).json({ success: false, error: '缺少必填字段' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: '密码至少 6 位' });
  }

  const verifyResult = await verifyCode(email, code, 'register');
  if (!verifyResult.ok) {
    return res.status(400).json({ success: false, error: verifyResult.reason });
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    return res.status(400).json({ success: false, error: '该邮箱已注册' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const defaultNickname = nickname || `用户${email.split('@')[0].slice(0, 8)}`;

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      nickname: defaultNickname,
    })
    .select('id, email, nickname, role, status')
    .single();

  if (error) {
    console.error('[register] 创建用户失败:', error);
    return res.status(500).json({ success: false, error: '注册失败' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  // 反滥用：建立 user ↔ fingerprint / IP 关联 + 异步评估 register 规则
  ensureAbuse(req);
  const ip = getClientIp(req);
  recordFingerprint(req, user.id).catch((e) =>
    console.warn('[register] recordFingerprint:', e && e.message)
  );
  recordIp(ip, user.id).catch((e) =>
    console.warn('[register] recordIp:', e && e.message)
  );
  triggerRiskEval(user.id, 'register', req, {});

  res.json({ success: true, data: { user, token } });
});

// 登录
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!validateEmail(email) || !password) {
    return res.status(400).json({ success: false, error: '请填写完整信息' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) {
    return res.status(400).json({ success: false, error: '邮箱或密码不正确' });
  }

  if (user.status === 'banned') {
    return res.status(403).json({
      success: false,
      code: 'BANNED',
      error: '账号已被封禁，请联系管理员',
    });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(400).json({ success: false, error: '邮箱或密码不正确' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const { password_hash, ...safeUser } = user;
  res.json({ success: true, data: { user: safeUser, token } });
});

// 重置密码（通过邮箱验证码）
// 挂 IP 级限流防止暴力枚举 6 位验证码
router.post('/reset-password', rateLimitResetPassword(), async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!validateEmail(email)) {
    return res.status(400).json({ success: false, error: '邮箱格式不正确' });
  }
  if (!code || !newPassword) {
    return res.status(400).json({ success: false, error: '缺少必填字段' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: '新密码至少 6 位' });
  }

  const verifyResult = await verifyCode(email, code, 'reset');
  if (!verifyResult.ok) {
    return res.status(400).json({ success: false, error: verifyResult.reason });
  }

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (!user) {
    return res.status(400).json({ success: false, error: '用户不存在' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: newHash })
    .eq('id', user.id);

  if (error) {
    return res.status(500).json({ success: false, error: '密码重置失败' });
  }

  res.json({ success: true, message: '密码重置成功，请用新密码登录' });
});

// 修改密码（登录态下）
router.put(
  '/change-password',
  require('../middleware/auth').authMiddleware,
  async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: '请填写完整信息' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: '新密码至少 6 位' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(400).json({ success: false, error: '用户不存在' });
    }

    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, error: '旧密码不正确' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await supabase.from('users').update({ password_hash: newHash }).eq('id', userId);

    res.json({ success: true });
  }
);

module.exports = router;
