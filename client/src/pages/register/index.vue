<template>
  <view class="register-page">
    <view class="form">
      <input
        v-model="phone"
        type="number"
        placeholder="请输入手机号"
        maxlength="11"
        class="input"
      />
      <view class="code-row">
        <input
          v-model="code"
          type="number"
          placeholder="验证码"
          maxlength="6"
          class="input code-input"
        />
        <button
          class="btn-code"
          :disabled="countdown > 0"
          @click="handleSendCode"
        >
          {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
        </button>
      </view>
      <input
        v-model="password"
        type="password"
        placeholder="设置密码（至少6位）"
        class="input"
      />
      <input
        v-model="nickname"
        placeholder="昵称（选填）"
        maxlength="20"
        class="input"
      />
      <button class="btn-primary" :disabled="loading" @click="handleRegister">
        {{ loading ? '注册中...' : '注册' }}
      </button>
    </view>

    <view class="footer">
      <text class="link" @click="goLogin">已有账号？去登录</text>
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
      phone: phone.value,
      code: code.value,
      password: password.value,
      nickname: nickname.value || undefined,
    });
    uni.setStorageSync('token', res.data.token);
    uni.setStorageSync('user', JSON.stringify(res.data.user));
    uni.switchTab({ url: '/pages/index/index' });
  } catch (e) {
    // handled
  } finally {
    loading.value = false;
  }
}

function goLogin() {
  uni.navigateBack();
}
</script>

<style scoped>
.register-page {
  padding: 60rpx 40rpx;
  min-height: 100vh;
  background: #fff;
}
.form { margin-top: 40rpx; }
.input {
  border: 1rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  font-size: 30rpx;
}
.code-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}
.code-input {
  flex: 1;
  margin-bottom: 0;
}
.btn-code {
  width: 240rpx;
  background: #f0f0f0;
  color: #333;
  border: none;
  border-radius: 12rpx;
  font-size: 26rpx;
  padding: 24rpx 0;
}
.btn-code[disabled] {
  color: #999;
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
.footer {
  text-align: center;
  margin-top: 40rpx;
}
.link {
  color: #4A90D9;
  font-size: 28rpx;
}
</style>
