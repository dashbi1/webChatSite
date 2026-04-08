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
const uploadRoutes = require('./routes/upload');

const app = express();

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
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

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

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`工大圈子后端服务启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
