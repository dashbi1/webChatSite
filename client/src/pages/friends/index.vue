<template>
  <view class="friends-page">
    <view class="nav-row">
      <text class="nav-link" @click="goRequests">好友申请 ></text>
    </view>
    <view v-for="f in friends" :key="f.id" class="user-item" @click="goChat(f)">
      <image class="avatar" :src="f.avatar_url || '/static/default-avatar.png'" />
      <view class="info">
        <text class="nick">{{ f.nickname }}</text>
        <text class="college">{{ f.college || '' }}</text>
      </view>
      <text class="chat-btn">💬</text>
    </view>
    <view v-if="friends.length === 0" class="empty"><text>还没有好友</text></view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getFriends } from '../../api/friend';

const friends = ref([]);

onShow(() => {
  loadFriends();
});

async function loadFriends() {
  const res = await getFriends();
  friends.value = res.data;
}

function goRequests() {
  uni.navigateTo({ url: '/pages/friend-requests/index' });
}

function goChat(f) {
  uni.navigateTo({ url: `/pages/chat/index?friendId=${f.id}&name=${f.nickname}` });
}

</script>

<style scoped>
.friends-page { min-height: 100vh; background: #f5f5f5; }
.nav-row { padding: 20rpx 24rpx; background: #fff; margin-bottom: 2rpx; }
.nav-link { color: #4A90D9; font-size: 28rpx; }
.user-item { display: flex; align-items: center; padding: 24rpx; background: #fff; margin-bottom: 2rpx; }
.avatar { width: 80rpx; height: 80rpx; border-radius: 50%; margin-right: 20rpx; background: #eee; }
.info { flex: 1; }
.nick { display: block; font-size: 30rpx; color: #333; }
.college { display: block; font-size: 24rpx; color: #999; }
.chat-btn { font-size: 36rpx; }
.empty { text-align: center; padding: 80rpx; color: #999; }
</style>
