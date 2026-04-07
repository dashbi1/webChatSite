<template>
  <view class="login-page">
    <view class="logo-area">
      <text class="title">工大圈子</text>
      <text class="subtitle">构建工大人自己的圈子</text>
    </view>

    <view class="form">
      <input
        v-model="phone"
        type="number"
        placeholder="请输入手机号"
        maxlength="11"
        class="input"
      />
      <input
        v-model="password"
        type="password"
        placeholder="请输入密码"
        class="input"
      />
      <button class="btn-primary" :disabled="loading" @click="handleLogin">
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </view>

    <view class="footer">
      <text class="link" @click="goRegister">没有账号？立即注册</text>
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
    // error toast already shown by request.js
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
  padding: 60rpx 40rpx;
  min-height: 100vh;
  background: #fff;
}
.logo-area {
  text-align: center;
  margin-bottom: 80rpx;
  padding-top: 100rpx;
}
.title {
  display: block;
  font-size: 56rpx;
  font-weight: bold;
  color: #4A90D9;
}
.subtitle {
  display: block;
  font-size: 28rpx;
  color: #999;
  margin-top: 16rpx;
}
.form {
  margin-bottom: 40rpx;
}
.input {
  border: 1rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  font-size: 30rpx;
}
.btn-primary {
  background: #4A90D9;
  color: #fff;
  border: none;
  border-radius: 12rpx;
  padding: 24rpx;
  font-size: 32rpx;
  margin-top: 20rpx;
}
.btn-primary[disabled] {
  opacity: 0.6;
}
.footer {
  text-align: center;
  margin-top: 40rpx;
}
.link {
  color: #4A90D9;
  font-size: 28rpx;
}
</style>
