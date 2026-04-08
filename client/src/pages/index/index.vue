<template>
  <view class="feed-page">
    <view class="top-bar">
      <text class="top-title">工大圈子</text>
      <view class="top-actions">
        <text class="icon-btn" @click="goSearch">🔍</text>
        <NotificationBell />
      </view>
    </view>

    <scroll-view
      scroll-y
      class="feed-list"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="loadMore"
    >
      <PostCard
        v-for="post in posts"
        :key="post.id"
        :post="post"
        @refresh="loadPosts"
      />
      <view v-if="posts.length === 0 && !loading" class="empty">
        <text>还没有人发帖，成为第一个吧！</text>
      </view>
      <view v-if="loading" class="loading-tip">
        <text>加载中...</text>
      </view>
      <view v-if="noMore && posts.length > 0" class="loading-tip">
        <text>没有更多了</text>
      </view>
    </scroll-view>

    <view class="fab" @click="goPublish">
      <text class="fab-text">+</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getPosts } from '../../api/post';
import NotificationBell from '../../components/NotificationBell.vue';
import PostCard from '../../components/PostCard.vue';

const posts = ref([]);
const page = ref(1);
const loading = ref(false);
const refreshing = ref(false);
const noMore = ref(false);

onShow(() => {
  checkLogin();
  loadPosts();
});

function checkLogin() {
  const token = uni.getStorageSync('token');
  if (!token) {
    uni.reLaunch({ url: '/pages/login/index' });
  }
}

async function loadPosts() {
  page.value = 1;
  noMore.value = false;
  loading.value = true;
  try {
    const res = await getPosts(1, 20);
    posts.value = res.data;
    if (res.data.length < 20) noMore.value = true;
  } catch (e) {
    // handled
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function loadMore() {
  if (loading.value || noMore.value) return;
  page.value++;
  loading.value = true;
  try {
    const res = await getPosts(page.value, 20);
    posts.value.push(...res.data);
    if (res.data.length < 20) noMore.value = true;
  } catch (e) {
    // handled
  } finally {
    loading.value = false;
  }
}

function onRefresh() {
  refreshing.value = true;
  loadPosts();
}

function goPublish() {
  uni.navigateTo({ url: '/pages/publish/index' });
}
function goSearch() {
  uni.navigateTo({ url: '/pages/search/index' });
}

</script>

<style scoped>
.feed-page {
  min-height: 100vh;
  background: #f5f5f5;
}
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 24rpx;
  background: #fff;
  border-bottom: 1rpx solid #eee;
  position: sticky;
  top: 0;
  z-index: 10;
}
.top-title {
  font-size: 36rpx;
  font-weight: bold;
  color: #4A90D9;
}
.top-actions { display: flex; gap: 24rpx; }
.icon-btn { font-size: 36rpx; }
.feed-list {
  height: calc(100vh - 100rpx);
  padding: 16rpx;
}
.empty {
  text-align: center;
  padding: 100rpx 0;
  color: #999;
  font-size: 28rpx;
}
.loading-tip {
  text-align: center;
  padding: 30rpx;
  color: #999;
  font-size: 26rpx;
}
.fab {
  position: fixed;
  right: 40rpx;
  bottom: 200rpx;
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  background: #4A90D9;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 16rpx rgba(74, 144, 217, 0.4);
}
.fab-text { color: #fff; font-size: 48rpx; line-height: 1; }
</style>
