<template>
  <view class="picker-mask" @click.self="$emit('close')">
    <view class="picker">
      <view class="picker-header">
        <text class="picker-title">选择好友</text>
        <text class="picker-close" @click="$emit('close')">✕</text>
      </view>
      <scroll-view scroll-y class="picker-list">
        <view
          v-for="f in friends"
          :key="f.id"
          class="friend-item"
          @click="$emit('select', f)"
        >
          <image class="avatar" :src="f.avatar_url || '/static/default-avatar.png'" />
          <text class="name">{{ f.nickname }}</text>
        </view>
        <view v-if="friends.length === 0" class="empty">
          <text>暂无好友</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getFriends } from '../api/friend';

defineEmits(['close', 'select']);

const friends = ref([]);

onMounted(async () => {
  try {
    const res = await getFriends();
    friends.value = res.data || [];
  } catch {}
});
</script>

<style scoped>
.picker-mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3); z-index: 9999;
}
.picker {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: #fff; border-radius: 24rpx 24rpx 0 0;
  max-height: 60vh; display: flex; flex-direction: column;
}
.picker-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 28rpx; border-bottom: 1rpx solid #f0f0f0;
}
.picker-title { font-size: 30rpx; font-weight: 600; }
.picker-close { font-size: 28rpx; color: #999; padding: 8rpx; }
.picker-list { flex: 1; }
.friend-item {
  display: flex; align-items: center; padding: 20rpx 28rpx;
  border-bottom: 1rpx solid #f5f5f5;
}
.friend-item:active { background: #f9f9f9; }
.avatar { width: 72rpx; height: 72rpx; border-radius: 50%; margin-right: 20rpx; background: #eee; }
.name { font-size: 28rpx; color: #333; }
.empty { text-align: center; padding: 60rpx; color: #999; font-size: 26rpx; }
</style>
