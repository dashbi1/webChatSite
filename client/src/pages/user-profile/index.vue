<template>
  <view class="profile-page" v-if="user">
    <view class="profile-card">
      <image class="avatar" :src="user.avatar_url || '/static/default-avatar.png'" />
      <text class="nickname">{{ user.nickname }}</text>
      <text class="meta">{{ user.college }} {{ user.grade }}</text>
      <text class="meta">发帖 {{ user.post_count }} 篇</text>
    </view>

    <view class="actions" v-if="!user.is_self">
      <button v-if="user.friend_status === 'none'" class="btn-primary" @click="addFriend">添加好友</button>
      <button v-else-if="user.friend_status === 'pending'" class="btn-disabled" disabled>等待验证</button>
      <button v-else-if="user.friend_status === 'accepted'" class="btn-chat" @click="goChat">发消息</button>
      <button class="btn-report" @click="reportUser">举报用户</button>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getUserProfile } from '../../api/user';
import { sendFriendRequest } from '../../api/friend';
import { submitReport } from '../../api/report';

const user = ref(null);
const userId = ref('');

onMounted(() => {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  userId.value = current.$page?.options?.id || current.options?.id;
  loadProfile();
});

async function loadProfile() {
  const res = await getUserProfile(userId.value);
  user.value = res.data;
}

async function addFriend() {
  await sendFriendRequest(userId.value);
  uni.showToast({ title: '申请已发送', icon: 'success' });
  user.value.friend_status = 'pending';
}

function goChat() {
  uni.navigateTo({ url: `/pages/chat/index?friendId=${userId.value}&name=${user.value.nickname}` });
}

function reportUser() {
  uni.showActionSheet({
    itemList: ['内容违规', '垃圾广告', '人身攻击', '其他'],
    success: async (res) => {
      const reasons = ['内容违规', '垃圾广告', '人身攻击', '其他'];
      try {
        await submitReport({ target_type: 'user', target_id: userId.value, reason: reasons[res.tapIndex] });
        uni.showToast({ title: '举报已提交', icon: 'success' });
      } catch {}
    },
  });
}
</script>

<style scoped>
.profile-page { min-height: 100vh; background: #f7f8fa; }
.profile-card {
  background: #fff; padding: 64rpx 40rpx 48rpx; text-align: center;
  border-radius: 0 0 32rpx 32rpx;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.04);
}
.avatar {
  width: 180rpx; height: 180rpx; border-radius: 50%; margin-bottom: 20rpx;
  background: #f0f2f5; border: 4rpx solid #fff;
  box-shadow: 0 4rpx 16rpx rgba(0,0,0,0.08);
}
.nickname { display: block; font-size: 38rpx; font-weight: 700; color: #1a1a2e; }
.meta { display: block; font-size: 26rpx; color: #999; margin-top: 8rpx; }
.actions { padding: 40rpx 32rpx; display: flex; flex-direction: column; gap: 16rpx; }
.btn-primary {
  background: linear-gradient(135deg, #4A90D9, #5DA0E5); color: #fff;
  border: none; border-radius: 16rpx; padding: 28rpx; font-size: 30rpx; font-weight: 600;
  box-shadow: 0 8rpx 24rpx rgba(74, 144, 217, 0.3);
}
.btn-disabled { background: #f0f2f5; color: #b0b0b0; border: none; border-radius: 16rpx; padding: 28rpx; font-size: 30rpx; }
.btn-chat { background: #27ae60; color: #fff; border: none; border-radius: 16rpx; padding: 28rpx; font-size: 30rpx; font-weight: 600; }
.btn-report { background: #fff; color: #e74c3c; border: none; border-radius: 16rpx; padding: 24rpx; font-size: 26rpx; }
</style>
