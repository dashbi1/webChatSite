<template>
  <view class="chat-list-page">
    <view v-for="conv in conversations" :key="conv.friend_id" class="conv-item" @click="goChat(conv)">
      <image class="avatar" :src="conv.friend?.avatar_url || conv.friend_avatar || '/static/default-avatar.png'" />
      <view class="conv-info">
        <text class="conv-name">{{ conv.friend?.nickname || conv.friend_nickname }}</text>
        <text class="conv-last">{{ conv.last_message }}</text>
      </view>
      <view class="conv-right">
        <text class="conv-time">{{ formatTime(conv.last_time) }}</text>
        <view v-if="conv.unread_count > 0" class="badge">{{ conv.unread_count }}</view>
      </view>
    </view>
    <view v-if="conversations.length === 0" class="empty"><text>暂无消息</text></view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { getConversations } from '../../api/chat';

const conversations = ref([]);

function onShow() {
  loadConversations();
}

async function loadConversations() {
  const res = await getConversations();
  conversations.value = res.data;
}

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

defineExpose({ onShow });
</script>

<style scoped>
.chat-list-page { min-height: 100vh; background: #f5f5f5; }
.conv-item { display: flex; align-items: center; padding: 24rpx; background: #fff; margin-bottom: 2rpx; }
.avatar { width: 96rpx; height: 96rpx; border-radius: 50%; margin-right: 20rpx; background: #eee; }
.conv-info { flex: 1; overflow: hidden; }
.conv-name { display: block; font-size: 30rpx; color: #333; font-weight: 500; }
.conv-last { display: block; font-size: 26rpx; color: #999; margin-top: 8rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-right { text-align: right; min-width: 100rpx; }
.conv-time { display: block; font-size: 22rpx; color: #999; }
.badge { background: #e74c3c; color: #fff; font-size: 22rpx; border-radius: 20rpx; padding: 4rpx 12rpx; margin-top: 8rpx; display: inline-block; }
.empty { text-align: center; padding: 80rpx; color: #999; }
</style>
