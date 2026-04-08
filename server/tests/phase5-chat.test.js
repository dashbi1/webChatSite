const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const { app, registerUser, cleanupUser, authGet, authPost, authPut } = require('./helpers');
const setupSocket = require('../src/socket/chatHandler');

describe('Phase 5: 实时私聊', () => {
  let server, serverAddr;
  let userA, userB, userC;
  const phones = [];

  beforeAll(async () => {
    // 启动带 Socket.io 的 HTTP server
    server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' } });
    setupSocket(io);

    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        serverAddr = `http://localhost:${port}`;
        resolve();
      });
    });

    // 注册3个用户，A和B互为好友，C是陌生人
    userA = await registerUser('聊天A');
    userB = await registerUser('聊天B');
    userC = await registerUser('聊天C');
    phones.push(userA.phone, userB.phone, userC.phone);

    // A 和 B 互加好友
    const reqRes = await authPost('/api/friends/request', userA.token, {
      addressee_id: userB.user.id,
    });
    await authPut(`/api/friends/request/${reqRes.body.data.id}`, userB.token, {
      action: 'accept',
    });
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
    await new Promise((resolve) => server.close(resolve));
  });

  function connectClient(token) {
    return ioClient(serverAddr, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
  }

  describe('Socket.io 连接', () => {
    test('有效 token → 连接成功', (done) => {
      const client = connectClient(userA.token);
      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });
    });

    test('无效 token → 连接失败', (done) => {
      const client = connectClient('invalid-token');
      client.on('connect_error', (err) => {
        expect(err.message).toMatch(/Token/);
        client.disconnect();
        done();
      });
    });
  });

  describe('chat:send / chat:receive - 实时消息', () => {
    test('好友 A→B 发消息 → B 实时收到', (done) => {
      const clientA = connectClient(userA.token);
      const clientB = connectClient(userB.token);

      let aConnected = false, bConnected = false;

      function tryTest() {
        if (!aConnected || !bConnected) return;

        clientB.on('chat:receive', (msg) => {
          expect(msg.content).toBe('你好B！');
          expect(msg.sender_id).toBe(userA.user.id);
          expect(msg.receiver_id).toBe(userB.user.id);
          expect(msg.sender).toBeDefined();
          expect(msg.sender.nickname).toBe('聊天A');
          clientA.disconnect();
          clientB.disconnect();
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: '你好B！',
        });
      }

      clientA.on('connect', () => { aConnected = true; tryTest(); });
      clientB.on('connect', () => { bConnected = true; tryTest(); });
    });

    test('发送者收到 chat:sent 回执', (done) => {
      const clientA = connectClient(userA.token);

      clientA.on('connect', () => {
        clientA.on('chat:sent', (msg) => {
          expect(msg.content).toBe('回执测试');
          expect(msg.sender_id).toBe(userA.user.id);
          clientA.disconnect();
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: '回执测试',
        });
      });
    });

    test('非好友 C→A 发消息 → 收到 error', (done) => {
      const clientC = connectClient(userC.token);

      clientC.on('connect', () => {
        clientC.on('chat:error', (data) => {
          expect(data.error).toMatch(/好友/);
          clientC.disconnect();
          done();
        });

        clientC.emit('chat:send', {
          receiverId: userA.user.id,
          content: '不应该成功',
        });
      });
    });
  });

  describe('GET /api/messages/:friendId - 聊天记录', () => {
    test('A 查看和 B 的聊天记录 → 返回消息', async () => {
      const res = await authGet(`/api/messages/${userB.user.id}`, userA.token);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      // 消息按时间正序
      const times = res.body.data.map(m => new Date(m.created_at).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });

    test('消息包含 sender 信息', async () => {
      const res = await authGet(`/api/messages/${userB.user.id}`, userA.token);
      for (const msg of res.body.data) {
        expect(msg.sender).toBeDefined();
        expect(msg.sender.nickname).toBeDefined();
      }
    });
  });

  describe('GET /api/messages/conversations - 会话列表', () => {
    test('A 的会话列表包含 B', async () => {
      const res = await authGet('/api/messages/conversations', userA.token);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      const convWithB = res.body.data.find(c => c.friend_id === userB.user.id);
      expect(convWithB).toBeDefined();
      expect(convWithB.last_message).toBeDefined();
    });
  });
});
