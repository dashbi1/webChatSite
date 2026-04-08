const request = require('supertest');
const app = require('../src/app');
const supabase = require('../src/config/supabase');

// 生成唯一手机号避免测试冲突
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter++;
  return `139${String(Date.now()).slice(-4)}${String(phoneCounter).padStart(4, '0')}`;
}

// 注册并返回 { user, token }
async function registerUser(nickname) {
  const phone = uniquePhone();
  // 发送验证码
  await request(app)
    .post('/api/auth/send-code')
    .send({ phone });

  // 注册
  const res = await request(app)
    .post('/api/auth/register')
    .send({ phone, code: '123456', password: 'test123', nickname });

  return { user: res.body.data.user, token: res.body.data.token, phone };
}

// 清理测试用户（按手机号）
async function cleanupUser(phone) {
  // 先删除关联数据再删用户
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (user) {
    await supabase.from('likes').delete().eq('user_id', user.id);
    await supabase.from('comments').delete().eq('user_id', user.id);
    await supabase.from('messages').delete().or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
    await supabase.from('notifications').delete().eq('user_id', user.id);
    await supabase.from('friendships').delete().or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    await supabase.from('posts').delete().eq('author_id', user.id);
    await supabase.from('users').delete().eq('id', user.id);
  }
}

// 带认证的请求
function authGet(url, token) {
  return request(app).get(url).set('Authorization', `Bearer ${token}`);
}

function authPost(url, token, data) {
  return request(app).post(url).set('Authorization', `Bearer ${token}`).send(data);
}

function authPut(url, token, data) {
  return request(app).put(url).set('Authorization', `Bearer ${token}`).send(data);
}

function authDelete(url, token) {
  return request(app).delete(url).set('Authorization', `Bearer ${token}`);
}

module.exports = {
  app,
  request,
  supabase,
  uniquePhone,
  registerUser,
  cleanupUser,
  authGet,
  authPost,
  authPut,
  authDelete,
};
