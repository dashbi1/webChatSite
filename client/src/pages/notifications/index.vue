<template>
  <view class="notif-page">
    <view v-for="n in notifications" :key="n.id" class="notif-item" :class="{ unread: !n.is_read }">
      <text class="notif-type">{{ typeLabel(n.type) }}</text>
      <text class="notif-content">{{ n.content }}</text>
      <text class="notif-time">{{ formatTime(n.created_at) }}</text>
    </view>
    <view v-if="notifications.length === 0" class="empty"><text>暂无通知</text></view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { get, put } from '../../api/request';

const notifications = ref([]);

onMounted(async () => {
  const res = await get('/notifications');
  notifications.value = res.data;
  // 标记全部已读
  if (res.unread_count > 0) {
    await put('/notifications/read', {});
  }
});

function typeLabel(type) {
  const map = { friend_request: '好友', like: '点赞', comment: '评论', system: '系统' };
  return map[type] || type;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
.notif-page { min-height: 100vh; background: #f5f5f5; }
.notif-item { padding: 24rpx; background: #fff; margin-bottom: 2rpx; }
.notif-item.unread { border-left: 6rpx solid #4A90D9; }
.notif-type { display: inline-block; background: #f0f0f0; color: #666; font-size: 22rpx; padding: 4rpx 12rpx; border-radius: 8rpx; margin-right: 12rpx; }
.notif-content { font-size: 28rpx; color: #333; }
.notif-time { display: block; font-size: 22rpx; color: #999; margin-top: 8rpx; }
.empty { text-align: center; padding: 80rpx; color: #999; }
</style>
