const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const { app, registerUser, cleanupUser, authGet, authPost, authPut } = require('./helpers');
const setupSocket = require('../src/socket/chatHandler');
const { setIO } = require('../src/utils/notify');

describe('Phase 6: 通知系统', () => {
  let server, serverAddr;
  let userA, userB;
  const phones = [];

  beforeAll(async () => {
    server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' } });
    setupSocket(io);
    setIO(io);

    await new Promise((resolve) => {
      server.listen(0, () => {
        serverAddr = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    userA = await registerUser('通知A');
    userB = await registerUser('通知B');
    phones.push(userA.phone, userB.phone);
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

  describe('好友申请 → 通知', () => {
    test('A 发送好友申请 → B 收到通知', async () => {
      await authPost('/api/friends/request', userA.token, {
        addressee_id: userB.user.id,
      });

      // 检查 B 的通知
      const res = await authGet('/api/notifications?page=1', userB.token);
      expect(res.status).toBe(200);
      const friendNotif = res.body.data.find(n => n.type === 'friend_request');
      expect(friendNotif).toBeDefined();
      expect(friendNotif.content).toMatch(/通知A/);
      expect(friendNotif.trigger_user).toBeDefined();
      expect(friendNotif.trigger_user.id).toBe(userA.user.id);
      expect(friendNotif.is_read).toBe(false);
    });
  });

  describe('私聊 → 通知', () => {
    beforeAll(async () => {
      // 先让 B 接受 A 的好友申请
      const reqRes = await authGet('/api/friends/requests', userB.token);
      const pending = reqRes.body.data.find(r => r.requester_id === userA.user.id);
      if (pending) {
        await authPut(`/api/friends/request/${pending.id}`, userB.token, { action: 'accept' });
      }
    });

    test('A 发消息给 B → B 收到 message 类型通知', (done) => {
      const clientA = connectClient(userA.token);

      clientA.on('connect', () => {
        clientA.on('chat:sent', async () => {
          clientA.disconnect();
          // 检查 B 的通知
          const res = await authGet('/api/notifications?page=1', userB.token);
          const msgNotif = res.body.data.find(n => n.type === 'message');
          expect(msgNotif).toBeDefined();
          expect(msgNotif.content).toMatch(/通知A/);
          expect(msgNotif.trigger_user.id).toBe(userA.user.id);
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: '你好，这是测试消息',
        });
      });
    });

    test('消息预览不超过20字', (done) => {
      const clientA = connectClient(userA.token);
      const longMsg = 'ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890extra';

      clientA.on('connect', () => {
        clientA.on('chat:sent', async () => {
          clientA.disconnect();
          const res = await authGet('/api/notifications?page=1', userB.token);
          // 找到最新的 message 通知
          const msgNotifs = res.body.data.filter(n => n.type === 'message');
          const latest = msgNotifs[0]; // 按时间倒序，第一条是最新
          expect(latest).toBeDefined();
          // 通知内容不应包含完整的 45 字消息
          expect(latest.content).not.toContain('extra');
          expect(latest.content).toContain('...');
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: longMsg,
        });
      });
    });
  });

  describe('Socket 实时推送', () => {
    test('B 在线时收到 notification:new 事件', (done) => {
      const clientB = connectClient(userB.token);
      const clientA = connectClient(userA.token);

      let bReady = false, aReady = false;

      function tryTest() {
        if (!aReady || !bReady) return;

        clientB.on('notification:new', (notif) => {
          expect(notif.type).toBe('message');
          expect(notif.trigger_user).toBeDefined();
          clientA.disconnect();
          clientB.disconnect();
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: '实时通知测试',
        });
      }

      clientA.on('connect', () => { aReady = true; tryTest(); });
      clientB.on('connect', () => { bReady = true; tryTest(); });
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    test('返回未读数 > 0', async () => {
      const res = await authGet('/api/notifications/unread-count', userB.token);
      expect(res.status).toBe(200);
      expect(res.body.data.count).toBeGreaterThan(0);
    });
  });

  describe('PUT /api/notifications/:id/read', () => {
    test('标记单条已读', async () => {
      const listRes = await authGet('/api/notifications?page=1', userB.token);
      const unread = listRes.body.data.find(n => !n.is_read);
      expect(unread).toBeDefined();

      const res = await authPut(`/api/notifications/${unread.id}/read`, userB.token);
      expect(res.status).toBe(200);
      expect(res.body.data.is_read).toBe(true);
    });

    test('已读后未读数减少', async () => {
      const before = await authGet('/api/notifications/unread-count', userB.token);
      const listRes = await authGet('/api/notifications?page=1', userB.token);
      const unread = listRes.body.data.find(n => !n.is_read);
      if (unread) {
        await authPut(`/api/notifications/${unread.id}/read`, userB.token);
        const after = await authGet('/api/notifications/unread-count', userB.token);
        expect(after.body.data.count).toBeLessThan(before.body.data.count);
      }
    });
  });
});
