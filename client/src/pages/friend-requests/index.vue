<template>
  <view class="requests-page">
    <view v-for="r in requests" :key="r.id" class="request-item">
      <image class="avatar" :src="r.requester?.avatar_url || '/static/default-avatar.png'" />
      <view class="info">
        <text class="nick">{{ r.requester?.nickname }}</text>
        <text class="college">{{ r.requester?.college || '' }}</text>
      </view>
      <view class="btns">
        <button class="btn-accept" @click="handle(r.id, 'accept')">同意</button>
        <button class="btn-reject" @click="handle(r.id, 'reject')">拒绝</button>
      </view>
    </view>
    <view v-if="requests.length === 0" class="empty"><text>暂无新的好友申请</text></view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getFriendRequests, handleFriendRequest } from '../../api/friend';

const requests = ref([]);

onMounted(loadRequests);

async function loadRequests() {
  const res = await getFriendRequests();
  requests.value = res.data;
}

async function handle(id, action) {
  await handleFriendRequest(id, action);
  uni.showToast({ title: action === 'accept' ? '已同意' : '已拒绝', icon: 'success' });
  requests.value = requests.value.filter(r => r.id !== id);
}
</script>

<style scoped>
.requests-page { min-height: 100vh; background: #f5f5f5; }
.request-item { display: flex; align-items: center; padding: 24rpx; background: #fff; margin-bottom: 2rpx; }
.avatar { width: 80rpx; height: 80rpx; border-radius: 50%; margin-right: 20rpx; background: #eee; }
.info { flex: 1; }
.nick { display: block; font-size: 30rpx; color: #333; }
.college { display: block; font-size: 24rpx; color: #999; }
.btns { display: flex; gap: 12rpx; }
.btn-accept { background: #4A90D9; color: #fff; border: none; border-radius: 8rpx; font-size: 24rpx; padding: 12rpx 24rpx; }
.btn-reject { background: #f0f0f0; color: #666; border: none; border-radius: 8rpx; font-size: 24rpx; padding: 12rpx 24rpx; }
.empty { text-align: center; padding: 80rpx; color: #999; }
</style>
