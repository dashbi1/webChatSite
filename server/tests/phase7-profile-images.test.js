const path = require('path');
const fs = require('fs');
const { app, request, registerUser, cleanupUser, authGet, authPost, authPut, authDelete, supabase } = require('./helpers');

describe('Phase 7: 资料编辑 + 图片帖 + 帖子管理', () => {
  let userA, userB;
  const phones = [];

  beforeAll(async () => {
    userA = await registerUser('图片A');
    userB = await registerUser('图片B');
    phones.push(userA.phone, userB.phone);
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('PUT /api/users/me - 更新资料', () => {
    test('更新昵称和学院 → 成功', async () => {
      const res = await authPut('/api/users/me', userA.token, {
        nickname: '新昵称A',
        college: '计算机学院',
        grade: '2023级',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('更新后查询 → 数据已变', async () => {
      const res = await authGet('/api/users/me', userA.token);
      expect(res.body.data.nickname).toBe('新昵称A');
      expect(res.body.data.college).toBe('计算机学院');
      expect(res.body.data.grade).toBe('2023级');
    });
  });

  describe('POST /api/upload/avatar - 头像上传', () => {
    test('上传 1x1 PNG → 返回 avatar_url', async () => {
      // 创建最小 PNG (1x1 transparent)
      const pngBuf = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000a49444154789c626000000002000198e195280000000049454e44ae426082',
        'hex'
      );

      const res = await request(app)
        .post('/api/upload/avatar')
        .set('Authorization', `Bearer ${userA.token}`)
        .attach('file', pngBuf, { filename: 'avatar.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatar_url).toMatch(/avatars/);
    });

    test('无文件 → 400', async () => {
      const res = await request(app)
        .post('/api/upload/avatar')
        .set('Authorization', `Bearer ${userA.token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/upload/post-image - 帖子图片上传', () => {
    test('上传图片 → 返回 url', async () => {
      const pngBuf = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000a49444154789c626000000002000198e195280000000049454e44ae426082',
        'hex'
      );

      const res = await request(app)
        .post('/api/upload/post-image')
        .set('Authorization', `Bearer ${userA.token}`)
        .attach('file', pngBuf, { filename: 'test.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.data.url).toMatch(/post-images/);
    });
  });

  describe('POST /api/posts - 带图片发帖', () => {
    test('发带图帖子 → media_urls + media_type 正确', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '看看我拍的照片！',
        media_urls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.media_type).toBe('image');
      expect(res.body.data.media_urls).toHaveLength(2);
    });

    test('不带图帖子 → media_type=none', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '纯文字帖子',
      });
      expect(res.body.data.media_type).toBe('none');
      expect(res.body.data.media_urls).toEqual([]);
    });

    test('超过9张图 → 400', async () => {
      const urls = Array(10).fill('https://example.com/img.jpg');
      const res = await authPost('/api/posts', userA.token, {
        content: '太多图了',
        media_urls: urls,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/9/);
    });
  });

  describe('GET /api/posts - 信息流中的图片', () => {
    test('图片帖在列表中包含 media_urls', async () => {
      const res = await authGet('/api/posts?page=1', userA.token);
      const imgPost = res.body.data.find(p => p.media_type === 'image');
      expect(imgPost).toBeDefined();
      expect(imgPost.media_urls.length).toBeGreaterThan(0);
    });
  });

  describe('帖子编辑/删除', () => {
    let postId;

    beforeAll(async () => {
      const res = await authPost('/api/posts', userA.token, { content: '待操作帖子' });
      postId = res.body.data.id;
    });

    test('编辑自己的帖子 → 成功 + is_edited', async () => {
      const res = await authPut(`/api/posts/${postId}`, userA.token, {
        content: '已编辑内容',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('已编辑内容');
      expect(res.body.data.is_edited).toBe(true);
    });

    test('他人编辑 → 403', async () => {
      const res = await authPut(`/api/posts/${postId}`, userB.token, {
        content: '不应该成功',
      });
      expect(res.status).toBe(403);
    });

    test('删除自己的帖子 → 成功', async () => {
      const res = await authDelete(`/api/posts/${postId}`, userA.token);
      expect(res.status).toBe(200);
    });

    test('删除他人帖子 → 403', async () => {
      const createRes = await authPost('/api/posts', userA.token, { content: 'B不能删' });
      const res = await authDelete(`/api/posts/${createRes.body.data.id}`, userB.token);
      expect(res.status).toBe(403);
    });
  });
});
