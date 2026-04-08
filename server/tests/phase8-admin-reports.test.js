const { app, request, registerUser, cleanupUser, authGet, authPost, authPut, authDelete, supabase } = require('./helpers');

describe('Phase 8: 管理后台 + 举报', () => {
  let admin, userA, userB;
  const phones = [];

  beforeAll(async () => {
    // 注册普通用户
    userA = await registerUser('举报A');
    userB = await registerUser('举报B');
    phones.push(userA.phone, userB.phone);

    // 创建管理员（直接注册后改 role）
    admin = await registerUser('管理员');
    phones.push(admin.phone);
    await supabase.from('users').update({ role: 'admin' }).eq('id', admin.user.id);

    // 重新登录获取带 admin role 的 token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ phone: admin.phone, password: 'test123' });
    admin.token = loginRes.body.data.token;
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('管理员 API 权限', () => {
    test('非管理员访问 /api/admin/users → 403', async () => {
      const res = await authGet('/api/admin/users', userA.token);
      expect(res.status).toBe(403);
    });

    test('管理员访问 /api/admin/users → 200', async () => {
      const res = await authGet('/api/admin/users', admin.token);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('用户管理', () => {
    test('用户列表搜索', async () => {
      const res = await authGet(`/api/admin/users?q=${encodeURIComponent('举报A')}`, admin.token);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].nickname).toMatch(/举报A/);
    });

    test('封禁用户 → status=banned', async () => {
      const res = await authPut(`/api/admin/users/${userA.user.id}/ban`, admin.token);
      expect(res.status).toBe(200);

      // 验证被封禁用户无法登录
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ phone: userA.phone, password: 'test123' });
      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error).toMatch(/封禁/);
    });

    test('解封用户 → status=active', async () => {
      const res = await authPut(`/api/admin/users/${userA.user.id}/unban`, admin.token);
      expect(res.status).toBe(200);

      // 解封后可登录
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ phone: userA.phone, password: 'test123' });
      expect(loginRes.status).toBe(200);
    });

    test('不可封禁自己', async () => {
      const res = await authPut(`/api/admin/users/${admin.user.id}/ban`, admin.token);
      expect(res.status).toBe(400);
    });
  });

  describe('帖子管理', () => {
    let postId;

    beforeAll(async () => {
      const res = await authPost('/api/posts', userA.token, { content: '管理员测试帖子' });
      postId = res.body.data.id;
    });

    test('帖子列表 → 包含作者信息', async () => {
      const res = await authGet('/api/admin/posts', admin.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      const post = res.body.data.find(p => p.id === postId);
      expect(post).toBeDefined();
      expect(post.author).toBeDefined();
    });

    test('帖子搜索', async () => {
      const res = await authGet(`/api/admin/posts?q=${encodeURIComponent('管理员测试')}`, admin.token);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    test('管理员删帖', async () => {
      const res = await authDelete(`/api/admin/posts/${postId}`, admin.token);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/reports - 用户举报', () => {
    let postByB;

    beforeAll(async () => {
      const res = await authPost('/api/posts', userB.token, { content: '被举报的帖子' });
      postByB = res.body.data;
    });

    test('举报帖子 → 成功', async () => {
      const res = await authPost('/api/reports', userA.token, {
        target_type: 'post',
        target_id: postByB.id,
        reason: '内容违规',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
    });

    test('重复举报 → 400', async () => {
      const res = await authPost('/api/reports', userA.token, {
        target_type: 'post',
        target_id: postByB.id,
        reason: '垃圾广告',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/已举报/);
    });

    test('举报用户 → 成功', async () => {
      const res = await authPost('/api/reports', userA.token, {
        target_type: 'user',
        target_id: userB.user.id,
        reason: '人身攻击',
      });
      expect(res.status).toBe(200);
    });

    test('举报自己 → 400', async () => {
      const res = await authPost('/api/reports', userA.token, {
        target_type: 'user',
        target_id: userA.user.id,
        reason: '测试',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/自己/);
    });

    test('空原因 → 400', async () => {
      const res = await authPost('/api/reports', userA.token, {
        target_type: 'post',
        target_id: postByB.id,
        reason: '',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('举报处理', () => {
    test('举报列表 → 按状态筛选', async () => {
      const res = await authGet('/api/admin/reports?status=pending', admin.token);
      expect(res.status).toBe(200);
      for (const r of res.body.data) {
        expect(r.status).toBe('pending');
      }
      expect(res.body.data[0].reporter).toBeDefined();
    });

    test('处理举报 → resolve', async () => {
      const listRes = await authGet('/api/admin/reports?status=pending', admin.token);
      const report = listRes.body.data[0];
      expect(report).toBeDefined();

      const res = await authPut(`/api/admin/reports/${report.id}`, admin.token, { action: 'resolve' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('resolved');
    });

    test('驳回举报 → dismiss', async () => {
      const listRes = await authGet('/api/admin/reports?status=pending', admin.token);
      if (listRes.body.data.length > 0) {
        const report = listRes.body.data[0];
        const res = await authPut(`/api/admin/reports/${report.id}`, admin.token, { action: 'dismiss' });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('dismissed');
      }
    });

    test('无效操作 → 400', async () => {
      // 先创建一个新举报
      const newPost = await authPost('/api/posts', userB.token, { content: '另一个' });
      await authPost('/api/reports', userA.token, {
        target_type: 'post', target_id: newPost.body.data.id, reason: '测试',
      });
      const listRes = await authGet('/api/admin/reports?status=pending', admin.token);
      const report = listRes.body.data[0];

      const res = await authPut(`/api/admin/reports/${report.id}`, admin.token, { action: 'invalid' });
      expect(res.status).toBe(400);
    });
  });
});
