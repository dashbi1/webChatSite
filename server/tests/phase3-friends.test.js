const { registerUser, cleanupUser, authGet, authPost, authPut } = require('./helpers');

describe('Phase 3: 好友系统', () => {
  let userA, userB, userC;
  const phones = [];

  beforeAll(async () => {
    userA = await registerUser('好友A');
    userB = await registerUser('好友B');
    userC = await registerUser('好友C');
    phones.push(userA.phone, userB.phone, userC.phone);
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupUser(phone);
    }
  });

  describe('POST /api/friends/request - 发送好友申请', () => {
    test('A 向 B 发送申请 → 成功', async () => {
      const res = await authPost('/api/friends/request', userA.token, {
        addressee_id: userB.user.id,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
    });

    test('重复发送申请 → 400', async () => {
      const res = await authPost('/api/friends/request', userA.token, {
        addressee_id: userB.user.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/已发送|已经是好友/);
    });

    test('添加自己 → 400', async () => {
      const res = await authPost('/api/friends/request', userA.token, {
        addressee_id: userA.user.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/自己/);
    });
  });

  describe('GET /api/friends/requests - 好友申请列表', () => {
    test('B 能看到 A 的申请', async () => {
      const res = await authGet('/api/friends/requests', userB.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const fromA = res.body.data.find(r => r.requester_id === userA.user.id);
      expect(fromA).toBeDefined();
      expect(fromA.requester).toBeDefined();
      expect(fromA.requester.nickname).toBe('好友A');
    });

    test('A 的申请列表为空（A 是发起方）', async () => {
      const res = await authGet('/api/friends/requests', userA.token);
      expect(res.status).toBe(200);
      // A 没有收到申请
      const pending = res.body.data.filter(r => r.requester_id === userB.user.id);
      expect(pending.length).toBe(0);
    });
  });

  describe('PUT /api/friends/request/:id - 处理申请', () => {
    let friendshipId;

    beforeAll(async () => {
      const res = await authGet('/api/friends/requests', userB.token);
      const fromA = res.body.data.find(r => r.requester_id === userA.user.id);
      friendshipId = fromA.id;
    });

    test('B 接受 A 的申请 → 成功', async () => {
      const res = await authPut(`/api/friends/request/${friendshipId}`, userB.token, {
        action: 'accept',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('accepted');
    });

    test('无效操作 → 400', async () => {
      // C 向 B 发申请
      const reqRes = await authPost('/api/friends/request', userC.token, {
        addressee_id: userB.user.id,
      });

      const res = await authPut(`/api/friends/request/${reqRes.body.data.id}`, userB.token, {
        action: 'invalid',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/friends - 好友列表', () => {
    test('A 和 B 互为好友', async () => {
      const resA = await authGet('/api/friends', userA.token);
      expect(resA.status).toBe(200);
      const bInList = resA.body.data.find(f => f.id === userB.user.id);
      expect(bInList).toBeDefined();

      const resB = await authGet('/api/friends', userB.token);
      const aInList = resB.body.data.find(f => f.id === userA.user.id);
      expect(aInList).toBeDefined();
    });
  });

  describe('GET /api/users/search - 搜索用户', () => {
    test('搜索昵称 → 返回匹配用户', async () => {
      const res = await authGet(`/api/users/search?q=${encodeURIComponent('好友')}`, userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      // 不包含自己
      const self = res.body.data.find(u => u.id === userA.user.id);
      expect(self).toBeUndefined();
    });

    test('空关键词 → 空数组', async () => {
      const res = await authGet('/api/users/search?q=', userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /api/users/:id - 用户资料', () => {
    test('查看好友的资料 → friend_status=accepted', async () => {
      const res = await authGet(`/api/users/${userB.user.id}`, userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data.friend_status).toBe('accepted');
      expect(res.body.data.nickname).toBe('好友B');
    });

    test('查看陌生人资料 → friend_status=none', async () => {
      const res = await authGet(`/api/users/${userC.user.id}`, userA.token);
      expect(res.status).toBe(200);
      expect(res.body.data.friend_status).toMatch(/none|pending/);
    });
  });
});
