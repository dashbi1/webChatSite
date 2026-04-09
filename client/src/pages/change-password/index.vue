<template>
  <view class="page">
    <view class="form-card">
      <view class="input-group">
        <text class="input-icon">&#x1F512;</text>
        <input v-model="oldPassword" type="password" placeholder="旧密码" class="input" />
      </view>
      <view class="input-group">
        <text class="input-icon">&#x1F511;</text>
        <input v-model="newPassword" type="password" placeholder="新密码（至少6位）" class="input" />
      </view>
      <view class="input-group">
        <text class="input-icon">&#x1F511;</text>
        <input v-model="confirmPassword" type="password" placeholder="确认新密码" class="input" />
      </view>
      <button class="btn-primary" :disabled="loading" @click="handleChange">
        {{ loading ? '修改中...' : '修改密码' }}
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { put } from '../../api/request';

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const loading = ref(false);

async function handleChange() {
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }
  if (newPassword.value.length < 6) {
    uni.showToast({ title: '新密码至少6位', icon: 'none' });
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    uni.showToast({ title: '两次密码不一致', icon: 'none' });
    return;
  }
  loading.value = true;
  try {
    await put('/auth/change-password', {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    uni.showModal({
      title: '修改成功',
      content: '密码已修改，请重新登录',
      showCancel: false,
      success: () => {
        uni.removeStorageSync('token');
        uni.removeStorageSync('user');
        uni.reLaunch({ url: '/pages/login/index' });
      },
    });
  } catch {} finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding: 32rpx; }
.form-card {
  background: #fff; border-radius: 24rpx; padding: 40rpx 36rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.06);
}
.input-group {
  display: flex; align-items: center;
  background: #f7f8fa; border-radius: 16rpx;
  padding: 4rpx 24rpx; margin-bottom: 24rpx;
  border: 2rpx solid transparent;
}
.input-group:focus-within { border-color: #4A90D9; background: #fff; }
.input-icon { font-size: 28rpx; margin-right: 16rpx; flex-shrink: 0; }
.input { flex: 1; font-size: 28rpx; color: #333; padding: 24rpx 0; background: transparent; }
.btn-primary {
  width: 100%; height: 96rpx; line-height: 96rpx;
  background: linear-gradient(135deg, #4A90D9, #5DA0E5);
  color: #fff; border: none; border-radius: 16rpx;
  font-size: 30rpx; font-weight: 600; letter-spacing: 4rpx; margin-top: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(74, 144, 217, 0.35);
}
.btn-primary[disabled] { opacity: 0.5; box-shadow: none; }
</style>
