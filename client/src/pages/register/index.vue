<template>
  <view class="register-page">
    <view class="bg-deco">
      <view class="circle c1" />
    </view>

    <view class="content">
      <view class="header">
        <text class="title">创建账号</text>
        <text class="subtitle">加入工大圈子，认识更多校友</text>
      </view>

      <view class="form-card">
        <view class="input-group">
          <text class="input-icon">&#x1F4F1;</text>
          <input v-model="phone" type="number" placeholder="手机号" maxlength="11" class="input" />
        </view>

        <view class="code-row">
          <view class="input-group code-input-wrap">
            <text class="input-icon">&#x1F511;</text>
            <input v-model="code" type="number" placeholder="验证码" maxlength="6" class="input" />
          </view>
          <button class="btn-code" :disabled="countdown > 0" @click="handleSendCode">
            {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
          </button>
        </view>

        <view class="input-group">
          <text class="input-icon">&#x1F512;</text>
          <input v-model="password" type="password" placeholder="设置密码（至少6位）" class="input" />
        </view>

        <view class="input-group">
          <text class="input-icon">&#x1F464;</text>
          <input v-model="nickname" placeholder="昵称（选填）" maxlength="20" class="input" />
        </view>

        <button class="btn-primary" :disabled="loading" @click="handleRegister">
          {{ loading ? '注册中...' : '注册' }}
        </button>
      </view>

      <view class="footer">
        <text class="link" @click="goLogin">已有账号？<text class="link-bold">去登录</text></text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { sendCode, register } from '../../api/auth';

const phone = ref('');
const code = ref('');
const password = ref('');
const nickname = ref('');
const loading = ref(false);
const countdown = ref(0);
let timer = null;

async function handleSendCode() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    uni.showToast({ title: '请输入正确的手机号', icon: 'none' });
    return;
  }
  await sendCode(phone.value);
  uni.showToast({ title: '验证码已发送（测试：123456）', icon: 'none' });
  countdown.value = 60;
  timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) clearInterval(timer);
  }, 1000);
}

async function handleRegister() {
  if (!phone.value || !code.value || !password.value) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }
  if (password.value.length < 6) {
    uni.showToast({ title: '密码至少6位', icon: 'none' });
    return;
  }
  loading.value = true;
  try {
    const res = await register({
      phone: phone.value, code: code.value,
      password: password.value, nickname: nickname.value || undefined,
    });
    uni.setStorageSync('token', res.data.token);
    uni.setStorageSync('user', JSON.stringify(res.data.user));
    uni.switchTab({ url: '/pages/index/index' });
  } catch {} finally { loading.value = false; }
}

function goLogin() { uni.navigateBack(); }
</script>

<style scoped>
.register-page { min-height: 100vh; background: #f7f8fa; position: relative; overflow: hidden; }
.bg-deco { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
.circle { position: absolute; border-radius: 50%; }
.c1 { width: 400rpx; height: 400rpx; background: rgba(74, 144, 217, 0.06); top: -100rpx; left: -100rpx; }
.content { position: relative; z-index: 1; padding: 0 48rpx; }
.header { padding-top: 120rpx; margin-bottom: 48rpx; }
.title { display: block; font-size: 44rpx; font-weight: 700; color: #1a1a2e; }
.subtitle { display: block; font-size: 26rpx; color: #999; margin-top: 12rpx; }

.form-card {
  background: #fff; border-radius: 24rpx; padding: 40rpx 36rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.06);
}
.input-group {
  display: flex; align-items: center;
  background: #f7f8fa; border-radius: 16rpx;
  padding: 4rpx 24rpx; margin-bottom: 20rpx;
  border: 2rpx solid transparent;
}
.input-group:focus-within { border-color: #4A90D9; background: #fff; }
.input-icon { font-size: 28rpx; margin-right: 16rpx; flex-shrink: 0; }
.input { flex: 1; font-size: 28rpx; color: #333; padding: 22rpx 0; background: transparent; }

.code-row { display: flex; gap: 16rpx; align-items: stretch; }
.code-input-wrap { flex: 1; margin-bottom: 20rpx; }
.btn-code {
  width: 220rpx; background: #EBF3FC; color: #4A90D9;
  border: none; border-radius: 16rpx; font-size: 24rpx;
  font-weight: 600; margin-bottom: 20rpx; padding: 0 16rpx;
}
.btn-code[disabled] { color: #b0c4de; background: #f0f4f8; }

.btn-primary {
  width: 100%; height: 96rpx; line-height: 96rpx;
  background: linear-gradient(135deg, #4A90D9, #5DA0E5);
  color: #fff; border: none; border-radius: 16rpx;
  font-size: 30rpx; font-weight: 600; letter-spacing: 4rpx;
  margin-top: 12rpx;
  box-shadow: 0 8rpx 24rpx rgba(74, 144, 217, 0.35);
}
.btn-primary[disabled] { opacity: 0.5; box-shadow: none; }

.footer { text-align: center; margin-top: 40rpx; }
.link { font-size: 26rpx; color: #999; }
.link-bold { color: #4A90D9; font-weight: 600; }
</style>
