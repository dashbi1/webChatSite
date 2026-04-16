<template>
  <view v-if="visible" class="risk-banner">
    <text class="risk-banner-text">您的账号正在审核中，暂时无法发帖、发私聊或发好友申请</text>
    <text class="risk-banner-link" @click="goAppeal">申诉</text>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const visible = ref(false);

function checkFrozen() {
  try {
    const user = uni.getStorageSync('user');
    if (!user) {
      visible.value = false;
      return;
    }
    const restrictedUntil = user.restricted_until;
    if (!restrictedUntil) {
      visible.value = false;
      return;
    }
    const endTs = new Date(restrictedUntil).getTime();
    visible.value = Number.isFinite(endTs) && endTs > Date.now();
  } catch (e) {
    visible.value = false;
  }
}

function goAppeal() {
  uni.navigateTo({ url: '/pages/appeals/index' });
}

onMounted(() => {
  checkFrozen();
});

// 暴露方法供父组件手动刷新（如从服务端拉最新 /api/users/me 后）
defineExpose({ refresh: checkFrozen });
</script>

<style scoped>
.risk-banner {
  position: relative;
  background: #fff3cd;
  color: #856404;
  padding: 12rpx 24rpx;
  font-size: 26rpx;
  line-height: 1.5;
  border-bottom: 1rpx solid #ffeaa7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 100;
}
.risk-banner-text {
  flex: 1;
}
.risk-banner-link {
  color: #0056b3;
  margin-left: 16rpx;
  text-decoration: underline;
  font-size: 26rpx;
}
</style>
