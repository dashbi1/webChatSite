<template>
  <view class="feed-page">
    <RiskBanner />
    <view class="top-bar">
      <text class="top-title">工大圈子</text>
      <view class="top-actions">
        <view class="icon-wrap" @click="goSearch">
          <text class="icon-text">&#x1F50D;</text>
        </view>
        <NotificationBell />
      </view>
    </view>

    <view class="sort-tabs">
      <view class="tab-item" :class="{ active: sortMode === 'latest' }" @click="switchSort('latest')">
        <text class="tab-text">最新</text>
        <view v-if="sortMode === 'latest'" class="tab-indicator" />
      </view>
      <view class="tab-item" :class="{ active: sortMode === 'hot' }" @click="switchSort('hot')">
        <text class="tab-text">热门</text>
        <view v-if="sortMode === 'hot'" class="tab-indicator" />
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
        @share="onShare"
      />
      <template v-if="showSkeleton && posts.length === 0">
        <SkeletonPost v-for="i in 3" :key="'sk'+i" />
      </template>
      <view v-if="posts.length === 0 && !loading && !showSkeleton" class="empty-state">
        <text class="empty-icon">&#x1F4DD;</text>
        <text class="empty-text">还没有人发帖</text>
        <text class="empty-sub">成为第一个分享的人吧</text>
      </view>
      <view v-if="loading && posts.length > 0" class="loading-tip">
        <text class="loading-dot">...</text>
      </view>
      <view v-if="noMore && posts.length > 0" class="loading-tip">
        <text class="end-text">- 到底了 -</text>
      </view>
    </scroll-view>

    <view class="fab" @click="goPublish">
      <text class="fab-icon">+</text>
    </view>

    <FriendPicker
      v-if="showPicker"
      @close="showPicker = false"
      @select="forwardToFriend"
    />
  </view>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import { onShow, onHide } from '@dcloudio/uni-app';
import { getPosts } from '../../api/post';
import NotificationBell from '../../components/NotificationBell.vue';
import PostCard from '../../components/PostCard.vue';
import SkeletonPost from '../../components/SkeletonPost.vue';
import FriendPicker from '../../components/FriendPicker.vue';
import RiskBanner from '../../components/RiskBanner.vue';
import { getSocket } from '../../utils/socket';

const posts = ref([]);
const page = ref(1);
const loading = ref(false);
const refreshing = ref(false);
const noMore = ref(false);
const sortMode = ref('latest');
const showSkeleton = ref(true);
let pollTimer = null;

onShow(() => {
  checkLogin();
  // 先展示缓存
  const cached = uni.getStorageSync(`cache_posts_${sortMode.value}`);
  if (cached && posts.value.length === 0) {
    try { posts.value = JSON.parse(cached); } catch {}
  }
  // onShow 始终刷新（解决详情页返回后数据不一致）
  loadPosts();
  // 启动 30 秒轮询
  startPoll();
});

onHide(() => { stopPoll(); });
onUnmounted(() => { stopPoll(); });

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => { silentRefresh(); }, 30000);
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function silentRefresh() {
  try {
    const res = await getPosts(1, 20, sortMode.value);
    posts.value = res.data;
    uni.setStorageSync(`cache_posts_${sortMode.value}`, JSON.stringify(res.data));
  } catch {}
}

function checkLogin() {
  const token = uni.getStorageSync('token');
  if (!token) uni.reLaunch({ url: '/pages/login/index' });
}

function switchSort(mode) {
  if (sortMode.value === mode) return;
  sortMode.value = mode;
  loadPosts();
}

async function loadPosts() {
  page.value = 1;
  noMore.value = false;
  loading.value = true;
  if (posts.value.length === 0) showSkeleton.value = true;
  try {
    const res = await getPosts(1, 20, sortMode.value);
    posts.value = res.data;
    if (res.data.length < 20) noMore.value = true;
    uni.setStorageSync(`cache_posts_${sortMode.value}`, JSON.stringify(res.data));
  } catch {} finally {
    loading.value = false;
    refreshing.value = false;
    showSkeleton.value = false;
  }
}

async function loadMore() {
  if (loading.value || noMore.value) return;
  page.value++;
  loading.value = true;
  try {
    const res = await getPosts(page.value, 20, sortMode.value);
    posts.value.push(...res.data);
    if (res.data.length < 20) noMore.value = true;
  } catch {} finally { loading.value = false; }
}

function onRefresh() { refreshing.value = true; loadPosts(); }
function goPublish() { uni.navigateTo({ url: '/pages/publish/index' }); }
function goSearch() { uni.navigateTo({ url: '/pages/search/index' }); }

const showPicker = ref(false);
const sharePost = ref(null);

function onShare(post) { sharePost.value = post; showPicker.value = true; }

function forwardToFriend(friend) {
  showPicker.value = false;
  const socket = getSocket();
  if (!socket) return;
  socket.emit('chat:send', {
    receiverId: friend.id,
    content: '转发了一条帖子',
    messageType: 'post_share',
    referencePostId: sharePost.value.id,
  });
  uni.showToast({ title: `已转发给 ${friend.nickname}`, icon: 'success' });
}
</script>

<style scoped>
.feed-page { min-height: 100vh; background: #f7f8fa; }
.top-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 32rpx; background: #fff;
  position: sticky; top: 0; z-index: 10;
}
.top-title { font-size: 38rpx; font-weight: 700; color: #1a1a2e; letter-spacing: 2rpx; }
.top-actions { display: flex; align-items: center; gap: 20rpx; }
.icon-wrap { padding: 8rpx; }
.icon-text { font-size: 36rpx; }

.sort-tabs {
  display: flex; justify-content: center; gap: 64rpx;
  padding: 20rpx 0 0; background: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}
.tab-item {
  display: flex; flex-direction: column; align-items: center;
  padding-bottom: 16rpx; position: relative;
}
.tab-text { font-size: 28rpx; color: #999; }
.tab-item.active .tab-text { color: #4A90D9; font-weight: 600; }
.tab-indicator {
  width: 40rpx; height: 6rpx; border-radius: 3rpx;
  background: #4A90D9; margin-top: 8rpx;
}

.feed-list { height: calc(100vh - 180rpx); padding: 16rpx 24rpx; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 120rpx 0; gap: 12rpx;
}
.empty-icon { font-size: 80rpx; }
.empty-text { font-size: 30rpx; color: #666; font-weight: 500; }
.empty-sub { font-size: 24rpx; color: #b0b0b0; }

.loading-tip { text-align: center; padding: 32rpx; }
.loading-dot { font-size: 32rpx; color: #ccc; letter-spacing: 8rpx; }
.end-text { font-size: 24rpx; color: #ccc; }

.fab {
  position: fixed; right: 40rpx; bottom: 200rpx;
  width: 108rpx; height: 108rpx; border-radius: 50%;
  background: linear-gradient(135deg, #4A90D9, #5DA0E5);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8rpx 28rpx rgba(74, 144, 217, 0.4);
}
.fab-icon { color: #fff; font-size: 52rpx; line-height: 1; font-weight: 300; }
</style>
