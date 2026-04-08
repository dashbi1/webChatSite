<template>
  <view class="panel-mask" @click.self="$emit('close')">
    <view class="panel">
      <view class="panel-header">
        <text class="panel-title">通知</text>
        <text class="panel-close" @click="$emit('close')">✕</text>
      </view>

      <scroll-view
        scroll-y
        class="panel-list"
        @scrolltolower="loadMore"
      >
        <view
          v-for="item in notifications"
          :key="item.id"
          class="noti-item"
          @click="handleClick(item)"
        >
          <image
            class="noti-avatar"
            :src="item.trigger_user?.avatar_url || '/static/default-avatar.png'"
          />
          <view class="noti-body">
            <text class="noti-content">{{ item.content }}</text>
            <text class="noti-time">{{ formatTime(item.created_at) }}</text>
          </view>
          <view v-if="!item.is_read" class="noti-unread" />
        </view>

        <view v-if="notifications.length === 0 && !loading" class="empty">
          <text>暂无通知</text>
        </view>
        <view v-if="loading" class="loading-tip">
          <text>加载中...</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getNotifications, markAsRead } from '../api/notification';

const emit = defineEmits(['close', 'read']);

const notifications = ref([]);
const page = ref(1);
const loading = ref(false);
const noMore = ref(false);

onMounted(() => {
  loadNotifications();
});

async function loadNotifications() {
  if (loading.value || noMore.value) return;
  loading.value = true;
  try {
    const res = await getNotifications(page.value, 20);
    const list = res.data || [];
    if (list.length < 20) noMore.value = true;
    notifications.value = page.value === 1 ? list : [...notifications.value, ...list];
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  if (noMore.value) return;
  page.value++;
  loadNotifications();
}

async function handleClick(item) {
  // 标记已读
  if (!item.is_read) {
    try {
      await markAsRead(item.id);
      item.is_read = true;
      emit('read');
    } catch {
      // ignore
    }
  }

  // 跳转
  if (item.type === 'friend_request') {
    emit('close');
    uni.navigateTo({ url: '/pages/friend-requests/index' });
  } else if (item.type === 'message') {
    emit('close');
    // reference_id 是 message id，需要用 trigger_user_id 跳到聊天页
    const name = item.trigger_user?.nickname || '';
    uni.navigateTo({
      url: `/pages/chat/index?friendId=${item.trigger_user_id}&name=${encodeURIComponent(name)}`,
    });
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
.panel-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 9999;
}
.panel {
  position: absolute;
  top: 88rpx;
  right: 20rpx;
  width: 620rpx;
  max-height: 70vh;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.panel-title { font-size: 30rpx; font-weight: 600; color: #333; }
.panel-close { font-size: 28rpx; color: #999; padding: 8rpx; }
.panel-list { flex: 1; max-height: 60vh; }
.noti-item {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f5f5f5;
}
.noti-item:active { background: #f9f9f9; }
.noti-avatar {
  width: 64rpx; height: 64rpx; border-radius: 50%;
  background: #eee; flex-shrink: 0; margin-right: 20rpx;
}
.noti-body { flex: 1; min-width: 0; }
.noti-content { font-size: 26rpx; color: #333; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.noti-time { font-size: 22rpx; color: #bbb; margin-top: 8rpx; display: block; }
.noti-unread {
  width: 14rpx; height: 14rpx; background: #ff3b30;
  border-radius: 50%; flex-shrink: 0; margin-left: 12rpx;
}
.empty { text-align: center; padding: 60rpx; color: #999; font-size: 26rpx; }
.loading-tip { text-align: center; padding: 20rpx; color: #999; font-size: 24rpx; }
</style>
