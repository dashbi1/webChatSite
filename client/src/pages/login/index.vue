<template>
  <view class="login-page">
    <view class="bg-deco">
      <view class="circle c1" />
      <view class="circle c2" />
    </view>

    <view class="content">
      <view class="logo-area">
        <view class="logo-icon">
          <text class="logo-letter">H</text>
        </view>
        <text class="title">工大圈子</text>
        <text class="subtitle">构建工大人自己的圈子</text>
      </view>

      <view class="form-card">
        <view class="input-group">
          <text class="input-icon">&#x1F4F1;</text>
          <input
            v-model="phone"
            type="number"
            placeholder="请输入手机号"
            maxlength="11"
            class="input"
          />
        </view>
        <view class="input-group">
          <text class="input-icon">&#x1F512;</text>
          <input
            v-model="password"
            type="password"
            placeholder="请输入密码"
            class="input"
          />
        </view>
        <button class="btn-primary" :disabled="loading" @click="handleLogin">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </view>

      <view class="footer">
        <text class="link" @click="goRegister">没有账号？<text class="link-bold">立即注册</text></text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { login } from '../../api/auth';

const phone = ref('');
const password = ref('');
const loading = ref(false);

async function handleLogin() {
  if (!phone.value || !password.value) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }
  loading.value = true;
  try {
    const res = await login({ phone: phone.value, password: password.value });
    uni.setStorageSync('token', res.data.token);
    uni.setStorageSync('user', JSON.stringify(res.data.user));
    uni.switchTab({ url: '/pages/index/index' });
  } catch (e) {
  } finally {
    loading.value = false;
  }
}

function goRegister() {
  uni.navigateTo({ url: '/pages/register/index' });
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: #f7f8fa;
  position: relative;
  overflow: hidden;
}
.bg-deco { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
.circle { position: absolute; border-radius: 50%; }
.c1 { width: 500rpx; height: 500rpx; background: rgba(74, 144, 217, 0.08); top: -150rpx; right: -120rpx; }
.c2 { width: 300rpx; height: 300rpx; background: rgba(74, 144, 217, 0.05); bottom: 100rpx; left: -80rpx; }

.content { position: relative; z-index: 1; padding: 0 48rpx; }

.logo-area {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 180rpx; margin-bottom: 64rpx;
}
.logo-icon {
  width: 128rpx; height: 128rpx; border-radius: 32rpx;
  background: linear-gradient(135deg, #4A90D9, #6BA8E8);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 24rpx;
  box-shadow: 0 12rpx 32rpx rgba(74, 144, 217, 0.3);
}
.logo-letter { color: #fff; font-size: 64rpx; font-weight: 700; }
.title { font-size: 48rpx; font-weight: 700; color: #1a1a2e; letter-spacing: 4rpx; }
.subtitle { font-size: 26rpx; color: #999; margin-top: 12rpx; letter-spacing: 2rpx; }

.form-card {
  background: #fff; border-radius: 24rpx; padding: 48rpx 36rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.06);
}
.input-group {
  display: flex; align-items: center;
  background: #f7f8fa; border-radius: 16rpx;
  padding: 4rpx 24rpx; margin-bottom: 24rpx;
  border: 2rpx solid transparent;
  transition: border-color 0.2s;
}
.input-group:focus-within { border-color: #4A90D9; background: #fff; }
.input-icon { font-size: 32rpx; margin-right: 16rpx; flex-shrink: 0; }
.input { flex: 1; font-size: 28rpx; color: #333; padding: 24rpx 0; background: transparent; }

.btn-primary {
  width: 100%; height: 96rpx; line-height: 96rpx;
  background: linear-gradient(135deg, #4A90D9, #5DA0E5);
  color: #fff; border: none; border-radius: 16rpx;
  font-size: 30rpx; font-weight: 600; letter-spacing: 4rpx;
  margin-top: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(74, 144, 217, 0.35);
}
.btn-primary[disabled] { opacity: 0.5; box-shadow: none; }

.footer { text-align: center; margin-top: 48rpx; }
.link { font-size: 26rpx; color: #999; }
.link-bold { color: #4A90D9; font-weight: 600; }
</style>
