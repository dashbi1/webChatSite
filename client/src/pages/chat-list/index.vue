<template>
  <view class="chat-list-page">
    <view class="header-bar">
      <text class="page-title">消息</text>
      <NotificationBell />
    </view>

    <view class="conv-list">
      <view v-for="conv in conversations" :key="conv.friend_id" class="conv-card" @click="goChat(conv)">
        <view class="avatar-wrap">
          <image class="avatar" :src="conv.friend?.avatar_url || conv.friend_avatar || '/static/default-avatar.png'" />
          <view v-if="conv.unread_count > 0" class="unread-dot">
            <text class="unread-num">{{ conv.unread_count > 99 ? '99+' : conv.unread_count }}</text>
          </view>
        </view>
        <view class="conv-info">
          <view class="conv-top">
            <text class="conv-name">{{ conv.friend?.nickname || conv.friend_nickname }}</text>
            <text class="conv-time">{{ formatTime(conv.last_time) }}</text>
          </view>
          <text class="conv-last">{{ conv.last_message }}</text>
        </view>
      </view>
    </view>

    <view v-if="conversations.length === 0" class="empty-state">
      <text class="empty-icon">&#x1F4EC;</text>
      <text class="empty-text">暂无消息</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import NotificationBell from '../../components/NotificationBell.vue';
import { getConversations } from '../../api/chat';

const conversations = ref([]);
onShow(() => { loadConversations(); });
async function loadConversations() { const res = await getConversations(); conversations.value = res.data; }

function goChat(conv) {
  const name = conv.friend?.nickname || conv.friend_nickname;
  uni.navigateTo({ url: `/pages/chat/index?friendId=${conv.friend_id}&name=${name}` });
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
</script>

<style scoped>
.chat-list-page { min-height: 100vh; background: #f7f8fa; }
.header-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 32rpx; background: #fff;
}
.page-title { font-size: 36rpx; font-weight: 700; color: #1a1a2e; }

.conv-list { padding: 16rpx 24rpx; }
.conv-card {
  display: flex; align-items: center; padding: 24rpx 28rpx;
  background: #fff; margin-bottom: 12rpx; border-radius: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.03);
}
.avatar-wrap { position: relative; margin-right: 20rpx; flex-shrink: 0; }
.avatar { width: 96rpx; height: 96rpx; border-radius: 50%; background: #f0f2f5; }
.unread-dot {
  position: absolute; top: -4rpx; right: -4rpx;
  background: #e74c3c; border-radius: 20rpx; padding: 2rpx 10rpx;
  border: 3rpx solid #fff;
}
.unread-num { font-size: 20rpx; color: #fff; }

.conv-info { flex: 1; overflow: hidden; }
.conv-top { display: flex; justify-content: space-between; align-items: center; }
.conv-name { font-size: 30rpx; font-weight: 600; color: #1a1a2e; }
.conv-time { font-size: 22rpx; color: #b0b0b0; }
.conv-last {
  font-size: 26rpx; color: #999; margin-top: 8rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 120rpx 0; gap: 12rpx;
}
.empty-icon { font-size: 80rpx; }
.empty-text { font-size: 28rpx; color: #b0b0b0; }
</style>
