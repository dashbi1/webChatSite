const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未登录' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 每次请求查询用户当前状态
    const { data: user, error } = await supabase
      .from('users')
      .select('id, status, role')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, error: '用户不存在' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ success: false, error: '账号已被封禁', code: 'BANNED' });
    }

    // 用数据库最新的 role，而不是 token 里可能过期的
    req.user = { ...decoded, role: user.role, status: user.status };
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Token 无效或已过期' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '无管理员权限' });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware };
