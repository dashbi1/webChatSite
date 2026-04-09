<template>
  <view class="skeleton-card">
    <view class="skeleton-header">
      <view class="sk-avatar sk-pulse" />
      <view class="sk-info">
        <view class="sk-name sk-pulse" />
        <view class="sk-time sk-pulse" />
      </view>
    </view>
    <view class="sk-line sk-pulse" />
    <view class="sk-line sk-pulse short" />
    <view class="sk-actions">
      <view class="sk-btn sk-pulse" />
      <view class="sk-btn sk-pulse" />
      <view class="sk-btn sk-pulse" />
    </view>
  </view>
</template>

<style scoped>
.skeleton-card {
  background: #fff; padding: 28rpx 32rpx; margin-bottom: 16rpx;
  border-radius: 20rpx; box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.skeleton-header { display: flex; align-items: center; margin-bottom: 24rpx; }
.sk-avatar { width: 84rpx; height: 84rpx; border-radius: 50%; margin-right: 20rpx; }
.sk-info { flex: 1; }
.sk-name { width: 35%; height: 28rpx; border-radius: 8rpx; margin-bottom: 12rpx; }
.sk-time { width: 20%; height: 22rpx; border-radius: 8rpx; }
.sk-line { width: 100%; height: 24rpx; border-radius: 8rpx; margin-bottom: 14rpx; }
.sk-line.short { width: 55%; }
.sk-actions { display: flex; gap: 32rpx; margin-top: 20rpx; padding-top: 16rpx; border-top: 1rpx solid #f5f5f5; }
.sk-btn { width: 120rpx; height: 28rpx; border-radius: 8rpx; }
.sk-pulse {
  background: linear-gradient(90deg, #f0f2f5 25%, #e8eaed 50%, #f0f2f5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
