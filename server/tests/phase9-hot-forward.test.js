const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const { app, registerUser, cleanupUser, authGet, authPost, authPut } = require('./helpers');
const setupSocket = require('../src/socket/chatHandler');
const { setIO } = require('../src/utils/notify');

describe('Phase 9: 热帖排行 + 转发', () => {
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

    userA = await registerUser('热帖A');
    userB = await registerUser('热帖B');
    phones.push(userA.phone, userB.phone);

    // A 和 B 互为好友
    const reqRes = await authPost('/api/friends/request', userA.token, {
      addressee_id: userB.user.id,
    });
    await authPut(`/api/friends/request/${reqRes.body.data.id}`, userB.token, {
      action: 'accept',
    });
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

  describe('GET /api/posts?sort=hot - 热帖排行', () => {
    let coldPostId, hotPostId;

    beforeAll(async () => {
      // 发两条帖子
      const cold = await authPost('/api/posts', userA.token, { content: '冷帖子' });
      coldPostId = cold.body.data.id;

      const hot = await authPost('/api/posts', userA.token, { content: '热帖子' });
      hotPostId = hot.body.data.id;

      // 给热帖加点赞（自己）
      await authPost(`/api/posts/${hotPostId}/like`, userA.token);

      // 给热帖加评论
      await authPost(`/api/posts/${hotPostId}/comments`, userA.token, { content: '好帖！' });
    }, 60000);

    test('sort=hot → 热帖排在前面', async () => {
      const res = await authGet('/api/posts?sort=hot&page=1', userA.token);
      expect(res.status).toBe(200);
      const ids = res.body.data.map(p => p.id);
      const hotIdx = ids.indexOf(hotPostId);
      const coldIdx = ids.indexOf(coldPostId);
      // 热帖排在冷帖前面
      expect(hotIdx).toBeLessThan(coldIdx);
    });

    test('sort=latest → 按时间倒序', async () => {
      const res = await authGet('/api/posts?sort=latest&page=1', userA.token);
      const times = res.body.data.map(p => new Date(p.created_at).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
      }
    });

    test('默认 sort=latest', async () => {
      const res = await authGet('/api/posts?page=1', userA.token);
      expect(res.status).toBe(200);
      // 最新发的帖子在前
      const times = res.body.data.map(p => new Date(p.created_at).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
      }
    });
  });

  describe('GET /api/posts/detail/:id - 帖子详情', () => {
    let postId;

    beforeAll(async () => {
      const res = await authPost('/api/posts', userA.token, { content: '详情测试帖子' });
      postId = res.body.data.id;
    });

    test('获取帖子详情 → 包含作者信息', async () => {
      const res = await authGet(`/api/posts/detail/${postId}`, userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('详情测试帖子');
      expect(res.body.data.author).toBeDefined();
      expect(res.body.data.author.nickname).toBe('热帖A');
    });

    test('不存在的帖子 → 404', async () => {
      const res = await authGet('/api/posts/detail/00000000-0000-0000-0000-000000000000', userA.token);
      expect(res.status).toBe(404);
    });
  });

  describe('转发帖子到私聊', () => {
    let postId;

    beforeAll(async () => {
      const res = await authPost('/api/posts', userA.token, { content: '要转发的帖子内容很精彩' });
      postId = res.body.data.id;
    });

    test('A 转发帖子给 B → B 收到 post_share 消息', (done) => {
      const clientA = connectClient(userA.token);
      const clientB = connectClient(userB.token);

      let aReady = false, bReady = false;

      function tryTest() {
        if (!aReady || !bReady) return;

        clientB.on('chat:receive', (msg) => {
          expect(msg.message_type).toBe('post_share');
          expect(msg.reference_post_id).toBe(postId);
          expect(msg.sender_id).toBe(userA.user.id);
          clientA.disconnect();
          clientB.disconnect();
          done();
        });

        clientA.emit('chat:send', {
          receiverId: userB.user.id,
          content: '转发了一条帖子',
          messageType: 'post_share',
          referencePostId: postId,
        });
      }

      clientA.on('connect', () => { aReady = true; tryTest(); });
      clientB.on('connect', () => { bReady = true; tryTest(); });
    });

    test('转发消息保存在聊天记录中', async () => {
      const res = await authGet(`/api/messages/${userB.user.id}`, userA.token);
      const shareMsg = res.body.data.find(m => m.message_type === 'post_share');
      expect(shareMsg).toBeDefined();
      expect(shareMsg.reference_post_id).toBe(postId);
    });
  });
});
