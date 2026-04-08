<template>
  <view class="skeleton-card">
    <view class="skeleton-header">
      <view class="skeleton-avatar skeleton-pulse" />
      <view class="skeleton-info">
        <view class="skeleton-name skeleton-pulse" />
        <view class="skeleton-time skeleton-pulse" />
      </view>
    </view>
    <view class="skeleton-line skeleton-pulse" />
    <view class="skeleton-line skeleton-pulse short" />
  </view>
</template>

<style scoped>
.skeleton-card { background: #fff; padding: 24rpx; margin-bottom: 16rpx; border-radius: 12rpx; }
.skeleton-header { display: flex; align-items: center; margin-bottom: 20rpx; }
.skeleton-avatar { width: 80rpx; height: 80rpx; border-radius: 50%; margin-right: 16rpx; }
.skeleton-info { flex: 1; }
.skeleton-name { width: 40%; height: 28rpx; border-radius: 6rpx; margin-bottom: 10rpx; }
.skeleton-time { width: 25%; height: 22rpx; border-radius: 6rpx; }
.skeleton-line { width: 100%; height: 26rpx; border-radius: 6rpx; margin-bottom: 12rpx; }
.skeleton-line.short { width: 60%; }
.skeleton-pulse { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: pulse 1.5s infinite; }
@keyframes pulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
