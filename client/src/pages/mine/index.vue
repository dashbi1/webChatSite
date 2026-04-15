<template>
  <view class="mine-page">
    <!-- 个人卡片 -->
    <view class="profile-card">
      <view class="profile-bg" />
      <view class="profile-content">
        <view class="bell-row"><NotificationBell /></view>
        <image class="avatar" :src="user.avatar_url || '/static/default-avatar.png'" />
        <text class="nickname">{{ user.nickname || '未设置昵称' }}</text>
        <text class="meta" v-if="user.college || user.grade">{{ user.college || '' }} {{ user.grade || '' }}</text>
        <text class="phone">{{ user.email }}</text>
      </view>
    </view>

    <!-- 菜单组 -->
    <view class="menu-card">
      <view class="menu-item" @click="goEdit">
        <text class="menu-icon">&#x270F;</text>
        <text class="menu-text">编辑资料</text>
        <text class="menu-arrow">&#x203A;</text>
      </view>
      <view class="menu-item" @click="goFriends">
        <text class="menu-icon">&#x1F465;</text>
        <text class="menu-text">好友列表</text>
        <text class="menu-arrow">&#x203A;</text>
      </view>
      <view class="menu-item" @click="goRequests">
        <text class="menu-icon">&#x1F4E9;</text>
        <text class="menu-text">好友申请</text>
        <text class="menu-arrow">&#x203A;</text>
      </view>
      <view class="menu-item" @click="goChangePassword">
        <text class="menu-icon">&#x1F510;</text>
        <text class="menu-text">修改密码</text>
        <text class="menu-arrow">&#x203A;</text>
      </view>
    </view>

    <view v-if="user.role === 'admin'" class="menu-card">
      <view class="menu-item" @click="goAdmin">
        <text class="menu-icon">&#x2699;</text>
        <text class="menu-text">管理后台</text>
        <text class="menu-arrow">&#x203A;</text>
      </view>
    </view>

    <view class="logout-area">
      <button class="btn-logout" @click="handleLogout">退出登录</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getMe } from '../../api/user';
import NotificationBell from '../../components/NotificationBell.vue';

const user = ref({});

onShow(() => { loadUser(); });

async function loadUser() {
  try {
    const res = await getMe();
    user.value = res.data;
    uni.setStorageSync('user', JSON.stringify(res.data));
  } catch {}
}

function goEdit() { uni.navigateTo({ url: '/pages/edit-profile/index' }); }
function goFriends() { uni.navigateTo({ url: '/pages/friends/index' }); }
function goRequests() { uni.navigateTo({ url: '/pages/friend-requests/index' }); }
function goAdmin() { uni.navigateTo({ url: '/pages/admin/index' }); }
function goChangePassword() { uni.navigateTo({ url: '/pages/change-password/index' }); }

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
.mine-page { min-height: 100vh; background: #f7f8fa; }

.profile-card { position: relative; overflow: hidden; }
.profile-bg {
  position: absolute; top: 0; left: 0; right: 0; height: 280rpx;
  background: linear-gradient(135deg, #4A90D9, #6BB0F0);
}
.profile-content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center;
  padding: 60rpx 32rpx 40rpx;
}
.bell-row { align-self: flex-end; margin-bottom: 20rpx; }
.avatar {
  width: 160rpx; height: 160rpx; border-radius: 50%;
  background: #f0f2f5;
  border: 6rpx solid #fff;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.1);
}
.nickname { font-size: 36rpx; font-weight: 700; color: #1a1a2e; margin-top: 20rpx; }
.meta { font-size: 26rpx; color: #666; margin-top: 8rpx; }
.phone { font-size: 24rpx; color: #b0b0b0; margin-top: 4rpx; }

.menu-card {
  background: #fff; margin: 20rpx 24rpx 0;
  border-radius: 20rpx; overflow: hidden;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.menu-item {
  display: flex; align-items: center; padding: 32rpx;
  border-bottom: 1rpx solid #f5f5f5;
}
.menu-item:last-child { border-bottom: none; }
.menu-icon { font-size: 32rpx; margin-right: 20rpx; width: 40rpx; text-align: center; }
.menu-text { flex: 1; font-size: 28rpx; color: #333; }
.menu-arrow { font-size: 32rpx; color: #ccc; }

.logout-area { padding: 48rpx 24rpx; }
.btn-logout {
  background: #fff; color: #e74c3c; border: none;
  border-radius: 20rpx; padding: 28rpx; font-size: 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
</style>
