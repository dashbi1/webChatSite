const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const router = express.Router();

// 内存存储验证码（测试阶段）
const verificationCodes = new Map();

// 发送验证码
router.post('/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, error: '手机号格式不正确' });
  }

  // 测试阶段：固定验证码 123456
  verificationCodes.set(phone, {
    code: '123456',
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 分钟过期
  });

  res.json({ success: true, message: '验证码已发送' });
});

// 注册
router.post('/register', async (req, res) => {
  const { phone, code, password, nickname } = req.body;

  if (!phone || !code || !password) {
    return res.status(400).json({ success: false, error: '缺少必填字段' });
  }

  // 验证码校验
  const stored = verificationCodes.get(phone);
  if (!stored || stored.code !== code || Date.now() > stored.expiresAt) {
    return res.status(400).json({ success: false, error: '验证码不正确或已过期' });
  }
  verificationCodes.delete(phone);

  // 检查手机号是否已注册
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    return res.status(400).json({ success: false, error: '该手机号已注册' });
  }

  // 创建用户
  const passwordHash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase
    .from('users')
    .insert({
      phone,
      password_hash: passwordHash,
      nickname: nickname || `用户${phone.slice(-4)}`,
    })
    .select('id, phone, nickname, role, status')
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '注册失败' });
  }

  const token = jwt.sign(
    { id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ success: true, data: { user, token } });
});

// 登录
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, error: '缺少必填字段' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (error || !user) {
    return res.status(400).json({ success: false, error: '手机号或密码不正确' });
  }

  if (user.status === 'banned') {
    return res.status(403).json({ success: false, error: '账号已被封禁，请联系管理员' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(400).json({ success: false, error: '手机号或密码不正确' });
  }

  const token = jwt.sign(
    { id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const { password_hash, ...safeUser } = user;
  res.json({ success: true, data: { user: safeUser, token } });
});

module.exports = router;
