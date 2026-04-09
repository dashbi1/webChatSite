const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const { app, request, registerUser, cleanupUser, authGet, authPost, authPut, supabase } = require('./helpers');
const setupSocket = require('../src/socket/chatHandler');
const { setIO } = require('../src/utils/notify');

describe('Phase 11: 基础补全', () => {
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

    userA = await registerUser('基础A');
    userB = await registerUser('基础B');
    phones.push(userA.phone, userB.phone);
  }, 60000);

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

  describe('PUT /api/auth/change-password', () => {
    test('正确旧密码 → 修改成功', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ oldPassword: 'test123', newPassword: 'newpass456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('修改后旧密码无法登录', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: userA.phone, password: 'test123' });

      expect(res.status).toBe(400);
    });

    test('修改后新密码可以登录', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: userA.phone, password: 'newpass456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // 更新 token
      userA.token = res.body.data.token;
    });

    test('错误旧密码 → 400', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ oldPassword: 'wrongpassword', newPassword: 'another123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/旧密码/);
    });

    test('新密码太短 → 400', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ oldPassword: 'newpass456', newPassword: '123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/6/);
    });
  });

  describe('chat:error 事件 - 封禁用户发消息提示', () => {
    beforeAll(async () => {
      // A 和 B 互为好友
      const reqRes = await authPost('/api/friends/request', userA.token, {
        addressee_id: userB.user.id,
      });
      await authPut(`/api/friends/request/${reqRes.body.data.id}`, userB.token, {
        action: 'accept',
      });

      // 封禁 B
      await supabase.from('users').update({ status: 'banned' }).eq('id', userB.user.id);
    }, 60000);

    afterAll(async () => {
      // 解封 B
      await supabase.from('users').update({ status: 'active' }).eq('id', userB.user.id);
    });

    test('A 给被封禁的 B 发消息 → 收到 chat:error', (done) => {
      const clientA = connectClient(userA.token);

      clientA.on('connect', () => {
        clientA.on('chat:error', (data) => {
          expect(data.error).toMatch(/封禁/);
          clientA.disconnect();
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: '你好',
        });
      });
    });
  });
});
