const { app, request, uniquePhone, registerUser, cleanupUser } = require('./helpers');

describe('Phase 1: 认证系统', () => {
  const phones = [];

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('POST /api/auth/send-code', () => {
    test('合法手机号 → 发送成功', async () => {
      const res = await request(app)
        .post('/api/auth/send-code')
        .send({ phone: '13900001111' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('非法手机号 → 400', async () => {
      const res = await request(app)
        .post('/api/auth/send-code')
        .send({ phone: '123' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('空手机号 → 400', async () => {
      const res = await request(app)
        .post('/api/auth/send-code')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/register', () => {
    test('正常注册 → 返回 user + token', async () => {
      const phone = uniquePhone();
      phones.push(phone);

      await request(app).post('/api/auth/send-code').send({ phone });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ phone, code: '123456', password: 'test123', nickname: '测试A' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.phone).toBe(phone);
      expect(res.body.data.user.role).toBe('user');
      expect(res.body.data.token).toBeDefined();
    });

    test('错误验证码 → 400', async () => {
      const phone = uniquePhone();
      await request(app).post('/api/auth/send-code').send({ phone });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ phone, code: '000000', password: 'test123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/验证码/);
    });

    test('缺少字段 → 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ phone: '13900002222' });

      expect(res.status).toBe(400);
    });

    test('重复注册 → 400', async () => {
      const phone = uniquePhone();
      phones.push(phone);

      await request(app).post('/api/auth/send-code').send({ phone });
      await request(app)
        .post('/api/auth/register')
        .send({ phone, code: '123456', password: 'test123' });

      // 再次注册同一手机号
      await request(app).post('/api/auth/send-code').send({ phone });
      const res = await request(app)
        .post('/api/auth/register')
        .send({ phone, code: '123456', password: 'test123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/已注册/);
    });
  });

  describe('POST /api/auth/login', () => {
    let loginPhone;

    beforeAll(async () => {
      loginPhone = uniquePhone();
      phones.push(loginPhone);
      await request(app).post('/api/auth/send-code').send({ phone: loginPhone });
      await request(app)
        .post('/api/auth/register')
        .send({ phone: loginPhone, code: '123456', password: 'mypass123', nickname: '登录测试' });
    });

    test('正确密码 → 登录成功', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: loginPhone, password: 'mypass123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.phone).toBe(loginPhone);
      // 不应返回 password_hash
      expect(res.body.data.user.password_hash).toBeUndefined();
    });

    test('错误密码 → 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: loginPhone, password: 'wrongpassword' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/密码/);
    });

    test('不存在的手机号 → 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: '13900009999', password: 'test' });

      expect(res.status).toBe(400);
    });
  });

  describe('Auth 中间件', () => {
    test('无 token → 401', async () => {
      const res = await request(app).get('/api/posts');
      expect(res.status).toBe(401);
    });

    test('无效 token → 401', async () => {
      const res = await request(app)
        .get('/api/posts')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(401);
    });

    test('有效 token → 通过', async () => {
      const { token, phone } = await registerUser('中间件测试');
      phones.push(phone);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
