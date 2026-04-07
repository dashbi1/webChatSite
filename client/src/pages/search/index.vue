<template>
  <view class="search-page">
    <view class="search-bar">
      <input v-model="keyword" placeholder="搜索用户昵称" @confirm="doSearch" class="search-input" />
      <button class="btn-search" @click="doSearch">搜索</button>
    </view>
    <view v-for="user in users" :key="user.id" class="user-item" @click="goProfile(user.id)">
      <image class="avatar" :src="user.avatar_url || '/static/default-avatar.png'" />
      <view class="user-info">
        <text class="nick">{{ user.nickname }}</text>
        <text class="college">{{ user.college || '' }}</text>
      </view>
    </view>
    <view v-if="searched && users.length === 0" class="empty">
      <text>未找到相关用户</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { searchUsers } from '../../api/user';

const keyword = ref('');
const users = ref([]);
const searched = ref(false);

async function doSearch() {
  if (!keyword.value.trim()) return;
  searched.value = true;
  const res = await searchUsers(keyword.value);
  users.value = res.data;
}

function goProfile(id) {
  uni.navigateTo({ url: `/pages/user-profile/index?id=${id}` });
}
</script>

<style scoped>
.search-page { min-height: 100vh; background: #f5f5f5; }
.search-bar { display: flex; padding: 16rpx; background: #fff; gap: 16rpx; }
.search-input { flex: 1; border: 1rpx solid #e0e0e0; border-radius: 32rpx; padding: 16rpx 24rpx; font-size: 28rpx; }
.btn-search { width: 140rpx; background: #4A90D9; color: #fff; border: none; border-radius: 32rpx; font-size: 26rpx; padding: 16rpx 0; }
.user-item { display: flex; align-items: center; padding: 24rpx; background: #fff; margin-top: 2rpx; }
.avatar { width: 80rpx; height: 80rpx; border-radius: 50%; margin-right: 20rpx; background: #eee; }
.user-info { flex: 1; }
.nick { display: block; font-size: 30rpx; font-weight: 500; color: #333; }
.college { display: block; font-size: 24rpx; color: #999; margin-top: 4rpx; }
.empty { text-align: center; padding: 80rpx; color: #999; font-size: 28rpx; }
</style>
