<template>
  <view class="admin-page">
    <view class="search-bar">
      <input v-model="keyword" placeholder="搜索用户" class="search-input" @confirm="loadUsers" />
    </view>
    <view v-for="u in users" :key="u.id" class="user-item">
      <image class="avatar" :src="u.avatar_url || '/static/default-avatar.png'" />
      <view class="info">
        <text class="nick">{{ u.nickname }} ({{ u.email }})</text>
        <text class="status" :class="u.status">{{ u.status === 'active' ? '正常' : '已封禁' }}</text>
      </view>
      <button
        v-if="u.status === 'active'"
        class="btn-ban"
        @click="banUser(u.id)"
      >封禁</button>
      <button
        v-else
        class="btn-unban"
        @click="unbanUser(u.id)"
      >解封</button>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { get, put } from '../../api/request';

const users = ref([]);
const keyword = ref('');

onMounted(loadUsers);

async function loadUsers() {
  const q = keyword.value ? `&q=${keyword.value}` : '';
  const res = await get(`/admin/users?page=1&limit=50${q}`);
  users.value = res.data;
}

async function banUser(id) {
  await put(`/admin/users/${id}/ban`);
  uni.showToast({ title: '已封禁', icon: 'success' });
  loadUsers();
}

async function unbanUser(id) {
  await put(`/admin/users/${id}/unban`);
  uni.showToast({ title: '已解封', icon: 'success' });
  loadUsers();
}
</script>

<style scoped>
.admin-page { min-height: 100vh; background: #f5f5f5; }
.search-bar { padding: 16rpx; background: #fff; }
.search-input { border: 1rpx solid #e0e0e0; border-radius: 8rpx; padding: 16rpx; font-size: 28rpx; }
.user-item { display: flex; align-items: center; padding: 20rpx; background: #fff; margin-top: 2rpx; }
.avatar { width: 72rpx; height: 72rpx; border-radius: 50%; margin-right: 16rpx; background: #eee; }
.info { flex: 1; }
.nick { display: block; font-size: 28rpx; color: #333; }
.status { display: block; font-size: 22rpx; margin-top: 4rpx; }
.status.active { color: #27ae60; }
.status.banned { color: #e74c3c; }
.btn-ban { background: #e74c3c; color: #fff; border: none; border-radius: 8rpx; font-size: 24rpx; padding: 12rpx 24rpx; }
.btn-unban { background: #27ae60; color: #fff; border: none; border-radius: 8rpx; font-size: 24rpx; padding: 12rpx 24rpx; }
</style>
