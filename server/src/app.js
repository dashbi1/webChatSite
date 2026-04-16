require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const setupSocket = require('./socket/chatHandler');
const { setIO } = require('./utils/notify');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const adminRiskRoutes = require('./routes/adminRisk');
const adminClustersRoutes = require('./routes/admin/clusters');
const adminBulkBanRoutes = require('./routes/admin/bulkBan');
const adminAppealsRoutes = require('./routes/admin/appeals');
const appealsRoutes = require('./routes/appeals');
const uploadRoutes = require('./routes/upload');
const reportRoutes = require('./routes/reports');
const path = require('path');

const app = express();

// trust proxy：Nginx + Cloudflare 链路下让 req.ip 正确解析 X-Forwarded-For
// 搭配 src/utils/ip.js 的 getClientIp 使用
app.set('trust proxy', 1);

// 反滥用：启动时注册 12 条风控规则到引擎（测试环境也要注册以便集成测试跑）
require('./services/riskEngine/rules').registerAll();

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/risk', adminRiskRoutes);
app.use('/api/admin/clusters', adminClustersRoutes);
app.use('/api/admin/bulk-ban', adminBulkBanRoutes);
app.use('/api/admin/appeals', adminAppealsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/appeals', appealsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportRoutes);

// 管理后台静态文件
const adminPath = process.env.ADMIN_PATH || 'console-k8m2x7';
app.use(`/${adminPath}`, express.static(path.join(__dirname, '..', 'admin')));

// 全局错误处理
app.use((err, req, res, _next) => {
  console.error('Server Error:', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

// 仅在直接运行时启动服务器（非测试环境）
if (require.main === module) {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });
  setupSocket(io);
  setIO(io);

  // 反滥用：启动时加载一次性邮箱黑名单 + 调度 cron
  const {
    loadFromDb: loadDisposable,
  } = require('./services/disposableEmails/loader');
  const { startCron } = require('./cron');
  loadDisposable().catch((e) =>
    console.warn('[startup] disposable load failed:', e && e.message)
  );
  startCron();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`工大圈子后端服务启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
