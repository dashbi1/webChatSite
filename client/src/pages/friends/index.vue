<template>
  <view class="friends-page">
    <view class="header-bar">
      <text class="page-title">好友</text>
      <view class="header-right">
        <text class="req-link" @click="goRequests">好友申请</text>
        <NotificationBell />
      </view>
    </view>

    <view class="friend-list">
      <view v-for="f in friends" :key="f.id" class="friend-card" @click="goChat(f)">
        <image class="avatar" :src="f.avatar_url || '/static/default-avatar.png'" />
        <view class="friend-info">
          <text class="friend-name">{{ f.nickname }}</text>
          <text class="friend-college">{{ f.college || '' }}</text>
        </view>
        <view class="chat-icon-wrap">
          <text class="chat-icon">&#x1F4AC;</text>
        </view>
      </view>
    </view>

    <view v-if="friends.length === 0" class="empty-state">
      <text class="empty-icon">&#x1F465;</text>
      <text class="empty-text">还没有好友</text>
      <text class="empty-sub">去搜索页找到你的同学吧</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import NotificationBell from '../../components/NotificationBell.vue';
import { getFriends } from '../../api/friend';

const friends = ref([]);
onShow(() => { loadFriends(); });
async function loadFriends() { const res = await getFriends(); friends.value = res.data; }
function goRequests() { uni.navigateTo({ url: '/pages/friend-requests/index' }); }
function goChat(f) { uni.navigateTo({ url: `/pages/chat/index?friendId=${f.id}&name=${f.nickname}` }); }
</script>

<style scoped>
.friends-page { min-height: 100vh; background: #f7f8fa; }
.header-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 32rpx; background: #fff;
}
.page-title { font-size: 36rpx; font-weight: 700; color: #1a1a2e; }
.header-right { display: flex; align-items: center; gap: 20rpx; }
.req-link { font-size: 26rpx; color: #4A90D9; font-weight: 500; }

.friend-list { padding: 16rpx 24rpx; }
.friend-card {
  display: flex; align-items: center; padding: 24rpx 28rpx;
  background: #fff; margin-bottom: 12rpx; border-radius: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.03);
}
.avatar { width: 88rpx; height: 88rpx; border-radius: 50%; margin-right: 20rpx; background: #f0f2f5; }
.friend-info { flex: 1; }
.friend-name { display: block; font-size: 30rpx; font-weight: 600; color: #1a1a2e; }
.friend-college { display: block; font-size: 24rpx; color: #b0b0b0; margin-top: 4rpx; }
.chat-icon-wrap { padding: 16rpx; }
.chat-icon { font-size: 32rpx; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 120rpx 0; gap: 12rpx;
}
.empty-icon { font-size: 80rpx; }
.empty-text { font-size: 30rpx; color: #666; }
.empty-sub { font-size: 24rpx; color: #b0b0b0; }
</style>
