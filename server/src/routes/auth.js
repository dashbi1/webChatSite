const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { sendVerificationEmail } = require('../services/emailService');
const { createCode, verifyCode } = require('../services/verificationService');

const router = express.Router();

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const VALID_PURPOSES = new Set(['register', 'reset']);

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

// 发送验证码
router.post('/send-code', async (req, res) => {
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
});

// 注册
router.post('/register', async (req, res) => {
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
router.post('/reset-password', async (req, res) => {
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
