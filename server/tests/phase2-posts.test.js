const { registerUser, cleanupUser, authGet, authPost, authPut, authDelete } = require('./helpers');

describe('Phase 2: 信息流 + 发帖', () => {
  let userA, userB;
  const phones = [];

  beforeAll(async () => {
    userA = await registerUser('发帖者A');
    userB = await registerUser('浏览者B');
    phones.push(userA.phone, userB.phone);
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('POST /api/posts - 发布帖子', () => {
    test('正常发帖 → 返回帖子数据', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '这是一条测试帖子',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('这是一条测试帖子');
      expect(res.body.data.author_id).toBe(userA.user.id);
      expect(res.body.data.author).toBeDefined();
      expect(res.body.data.is_self).toBe(true);
      expect(res.body.data.like_count).toBe(0);
    });

    test('空内容 → 400', async () => {
      const res = await authPost('/api/posts', userA.token, { content: '' });
      expect(res.status).toBe(400);
    });

    test('纯空格 → 400', async () => {
      const res = await authPost('/api/posts', userA.token, { content: '   ' });
      expect(res.status).toBe(400);
    });

    test('超过1000字 → 400', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: 'x'.repeat(1001),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/1000/);
    });
  });

  describe('GET /api/posts - 信息流', () => {
    test('获取帖子列表 → 按时间倒序', async () => {
      // 用 userA 发两条帖子
      await authPost('/api/posts', userA.token, { content: '帖子1' });
      await authPost('/api/posts', userA.token, { content: '帖子2' });

      const res = await authGet('/api/posts?page=1&limit=10', userA.token);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      // 最新的在前面
      const times = res.body.data.map(p => new Date(p.created_at).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
      }
    });

    test('其他用户也能看到帖子', async () => {
      const res = await authGet('/api/posts?page=1', userB.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      // B 看 A 的帖子，is_self 应为 false
      const aPost = res.body.data.find(p => p.author_id === userA.user.id);
      expect(aPost).toBeDefined();
      expect(aPost.is_self).toBe(false);
    });

    test('帖子包含作者信息', async () => {
      const res = await authGet('/api/posts?page=1', userA.token);
      const post = res.body.data[0];
      expect(post.author).toBeDefined();
      expect(post.author.nickname).toBeDefined();
    });
  });

  describe('PUT /api/posts/:id - 编辑帖子', () => {
    let postId;

    beforeAll(async () => {
      const res = await authPost('/api/posts', userA.token, { content: '待编辑' });
      postId = res.body.data.id;
    });

    test('编辑自己的帖子 → 成功', async () => {
      const res = await authPut(`/api/posts/${postId}`, userA.token, {
        content: '已编辑的内容',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('已编辑的内容');
      expect(res.body.data.is_edited).toBe(true);
    });

    test('编辑他人帖子 → 403', async () => {
      const res = await authPut(`/api/posts/${postId}`, userB.token, {
        content: '试图编辑别人的帖子',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/posts/:id - 删除帖子', () => {
    test('删除自己的帖子 → 成功', async () => {
      const createRes = await authPost('/api/posts', userA.token, { content: '待删除' });
      const postId = createRes.body.data.id;

      const res = await authDelete(`/api/posts/${postId}`, userA.token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('删除他人帖子 → 403', async () => {
      const createRes = await authPost('/api/posts', userA.token, { content: '不能被B删' });
      const postId = createRes.body.data.id;

      const res = await authDelete(`/api/posts/${postId}`, userB.token);
      expect(res.status).toBe(403);
    });
  });
});
