const { app, request, registerUser, cleanupUser, authGet, authPost } = require('./helpers');

describe('Phase 10: 视频帖 + 性能', () => {
  let userA;
  const phones = [];

  beforeAll(async () => {
    userA = await registerUser('视频A');
    phones.push(userA.phone);
  }, 60000);

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('POST /api/upload/post-video - 视频上传', () => {
    test('上传小视频 → 返回 url', async () => {
      // 创建最小的假 MP4 (ftyp box header)
      const mp4Buf = Buffer.alloc(64);
      mp4Buf.writeUInt32BE(32, 0); // box size
      mp4Buf.write('ftyp', 4); // box type
      mp4Buf.write('isom', 8); // major brand

      const res = await request(app)
        .post('/api/upload/post-video')
        .set('Authorization', `Bearer ${userA.token}`)
        .attach('file', mp4Buf, { filename: 'test.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toMatch(/post-videos/);
    });

    test('非视频文件 → 400', async () => {
      const txtBuf = Buffer.from('not a video');
      const res = await request(app)
        .post('/api/upload/post-video')
        .set('Authorization', `Bearer ${userA.token}`)
        .attach('file', txtBuf, { filename: 'test.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/视频/);
    });

    test('无文件 → 400', async () => {
      const res = await request(app)
        .post('/api/upload/post-video')
        .set('Authorization', `Bearer ${userA.token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/posts - 视频帖/混合帖', () => {
    test('纯视频帖 → media_type=video', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '看我的视频',
        media_urls: ['https://example.com/test.mp4'],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.media_type).toBe('video');
    });

    test('图片+视频帖 → media_type=mixed', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '图片和视频都有',
        media_urls: ['https://example.com/img.jpg', 'https://example.com/clip.mp4'],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.media_type).toBe('mixed');
    });

    test('纯图片帖 → media_type=image', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '只有图片',
        media_urls: ['https://example.com/img.jpg'],
      });
      expect(res.body.data.media_type).toBe('image');
    });

    test('无附件 → media_type=none', async () => {
      const res = await authPost('/api/posts', userA.token, {
        content: '纯文字',
      });
      expect(res.body.data.media_type).toBe('none');
    });
  });

  describe('GET /api/posts - 视频帖在信息流中', () => {
    test('信息流包含视频帖', async () => {
      const res = await authGet('/api/posts?page=1', userA.token);
      const videoPost = res.body.data.find(p => p.media_type === 'video');
      expect(videoPost).toBeDefined();
    });

    test('sort=hot 也能返回视频帖', async () => {
      const res = await authGet('/api/posts?page=1&sort=hot', userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });
});
