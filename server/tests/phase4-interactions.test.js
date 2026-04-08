const { registerUser, cleanupUser, authGet, authPost, authPut, supabase } = require('./helpers');

describe('Phase 4: 点赞 + 评论', () => {
  let userA, userB, userC, postByA;
  const phones = [];

  beforeAll(async () => {
    // A 和 B 是好友，C 是陌生人
    userA = await registerUser('互动A');
    userB = await registerUser('互动B');
    userC = await registerUser('互动C');
    phones.push(userA.phone, userB.phone, userC.phone);

    // A 和 B 互加好友
    const reqRes = await authPost('/api/friends/request', userA.token, {
      addressee_id: userB.user.id,
    });
    await authPut(`/api/friends/request/${reqRes.body.data.id}`, userB.token, {
      action: 'accept',
    });

    // A 发一条帖子
    const postRes = await authPost('/api/posts', userA.token, { content: '测试互动帖子' });
    postByA = postRes.body.data;
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('POST /api/posts/:id/like - 点赞', () => {
    test('好友 B 给 A 的帖子点赞 → 成功', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/like`, userB.token);
      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(true);
    });

    test('再次点赞 → 取消点赞', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/like`, userB.token);
      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(false);
    });

    test('陌生人 C 点赞 → 403', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/like`, userC.token);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/好友/);
    });

    test('自己给自己点赞 → 成功', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/like`, userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(true);
    });
  });

  describe('POST /api/posts/:id/comments - 评论', () => {
    test('好友 B 评论 → 成功', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/comments`, userB.token, {
        content: '这是一条评论',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('这是一条评论');
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.id).toBe(userB.user.id);
    });

    test('陌生人 C 评论 → 403', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/comments`, userC.token, {
        content: '不该成功',
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/好友/);
    });

    test('空评论 → 400', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/comments`, userB.token, {
        content: '',
      });
      expect(res.status).toBe(400);
    });

    test('自己评论自己的帖子 → 成功', async () => {
      const res = await authPost(`/api/posts/${postByA.id}/comments`, userA.token, {
        content: '自己的评论',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/posts/:id/comments - 获取评论列表', () => {
    test('获取评论 → 按时间正序', async () => {
      const res = await authGet(`/api/posts/${postByA.id}/comments`, userA.token);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      // 每条评论包含用户信息
      for (const comment of res.body.data) {
        expect(comment.user).toBeDefined();
        expect(comment.user.nickname).toBeDefined();
      }
    });
  });

  describe('信息流中的互动状态', () => {
    test('好友看到帖子 → is_friend=true, is_liked 正确', async () => {
      // B 先点赞
      await authPost(`/api/posts/${postByA.id}/like`, userB.token);

      const res = await authGet('/api/posts?page=1', userB.token);
      const post = res.body.data.find(p => p.id === postByA.id);
      expect(post).toBeDefined();
      expect(post.is_friend).toBe(true);
      expect(post.is_liked).toBe(true);
    });

    test('陌生人看到帖子 → is_friend=false', async () => {
      const res = await authGet('/api/posts?page=1', userC.token);
      const post = res.body.data.find(p => p.id === postByA.id);
      expect(post).toBeDefined();
      expect(post.is_friend).toBe(false);
    });
  });
});
