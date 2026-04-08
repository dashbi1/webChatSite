<template>
  <view class="mine-page">
    <view class="top-bar"><NotificationBell /></view>
    <view class="profile-section">
      <image class="avatar" :src="user.avatar_url || '/static/default-avatar.png'" />
      <view class="info">
        <text class="nickname">{{ user.nickname || '未设置昵称' }}</text>
        <text class="meta">{{ user.college || '' }} {{ user.grade || '' }}</text>
      </view>
    </view>

    <view class="menu-list">
      <view class="menu-item" @click="goEdit">
        <text>编辑资料</text>
        <text class="arrow">></text>
      </view>
      <view class="menu-item" @click="goFriends">
        <text>好友列表</text>
        <text class="arrow">></text>
      </view>
      <view class="menu-item" @click="goRequests">
        <text>好友申请</text>
        <text class="arrow">></text>
      </view>
      <view v-if="user.role === 'admin'" class="menu-item" @click="goAdmin">
        <text>管理后台</text>
        <text class="arrow">></text>
      </view>
    </view>

    <button class="btn-logout" @click="handleLogout">退出登录</button>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getMe } from '../../api/user';
import NotificationBell from '../../components/NotificationBell.vue';

const user = ref({});

onShow(() => {
  loadUser();
});

async function loadUser() {
  try {
    const res = await getMe();
    user.value = res.data;
    uni.setStorageSync('user', JSON.stringify(res.data));
  } catch (e) {
    // handled
  }
}

function goEdit() { uni.navigateTo({ url: '/pages/edit-profile/index' }); }
function goFriends() { uni.navigateTo({ url: '/pages/friends/index' }); }
function goRequests() { uni.navigateTo({ url: '/pages/friend-requests/index' }); }
function goAdmin() { uni.navigateTo({ url: '/pages/admin/index' }); }

function handleLogout() {
  uni.showModal({
    title: '确认退出',
    content: '确定要退出登录吗？',
    success(res) {
      if (res.confirm) {
        uni.removeStorageSync('token');
        uni.removeStorageSync('user');
        uni.reLaunch({ url: '/pages/login/index' });
      }
    },
  });
}

</script>

<style scoped>
.mine-page { min-height: 100vh; background: #f5f5f5; }
.top-bar { display: flex; justify-content: flex-end; padding: 16rpx 24rpx; background: #fff; }
.profile-section { display: flex; align-items: center; padding: 40rpx 30rpx; background: #fff; margin-bottom: 20rpx; }
.avatar { width: 120rpx; height: 120rpx; border-radius: 50%; margin-right: 24rpx; background: #eee; }
.info { flex: 1; }
.nickname { display: block; font-size: 34rpx; font-weight: bold; color: #333; }
.meta { display: block; font-size: 26rpx; color: #999; margin-top: 8rpx; }
.menu-list { background: #fff; margin-bottom: 20rpx; }
.menu-item { display: flex; justify-content: space-between; align-items: center; padding: 30rpx; border-bottom: 1rpx solid #f0f0f0; font-size: 30rpx; color: #333; }
.arrow { color: #ccc; }
.btn-logout { margin: 40rpx; background: #fff; color: #e74c3c; border: 1rpx solid #e74c3c; border-radius: 12rpx; padding: 24rpx; font-size: 30rpx; }
</style>
