<template>
  <view class="detail-page">
    <PostCard v-if="post" :post="post" @refresh="loadPost" />

    <view class="comments-section">
      <text class="section-title">评论 ({{ post?.comment_count || 0 }})</text>
      <view v-for="c in comments" :key="c.id" class="comment-item">
        <image class="comment-avatar" :src="c.user?.avatar_url || '/static/default-avatar.png'" />
        <view class="comment-body">
          <text class="comment-nick">{{ c.user?.nickname }}</text>
          <text class="comment-text">{{ c.content }}</text>
          <text class="comment-time">{{ formatTime(c.created_at) }}</text>
        </view>
      </view>
      <view v-if="comments.length === 0" class="empty-comment">
        <text>暂无评论</text>
      </view>
    </view>

    <view v-if="canInteract" class="comment-bar">
      <input v-model="commentText" placeholder="写评论..." class="comment-input" />
      <button class="btn-send" :disabled="!commentText.trim()" @click="handleComment">发送</button>
    </view>
    <view v-else class="comment-bar disabled-bar">
      <text class="disabled-text">添加好友后才能评论</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getComments, addComment } from '../../api/post';
import PostCard from '../../components/PostCard.vue';
import { get } from '../../api/request';

const post = ref(null);
const comments = ref([]);
const commentText = ref('');
const postId = ref('');

const canInteract = computed(() => post.value?.is_friend || post.value?.is_self);

onMounted(() => {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  postId.value = current.$page?.options?.id || current.options?.id;
  loadPost();
  loadComments();
});

async function loadPost() {
  // 重新获取单帖（复用列表接口 + 过滤）
  const res = await get(`/posts?page=1&limit=100`);
  post.value = res.data.find(p => p.id === postId.value) || null;
}

async function loadComments() {
  const res = await getComments(postId.value);
  comments.value = res.data;
}

async function handleComment() {
  if (!commentText.value.trim()) return;
  await addComment(postId.value, commentText.value);
  commentText.value = '';
  loadComments();
  loadPost();
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
.detail-page { min-height: 100vh; background: #f5f5f5; padding-bottom: 120rpx; }
.comments-section { background: #fff; margin-top: 16rpx; padding: 24rpx; }
.section-title { font-size: 30rpx; font-weight: 600; color: #333; margin-bottom: 20rpx; display: block; }
.comment-item { display: flex; padding: 16rpx 0; border-bottom: 1rpx solid #f0f0f0; }
.comment-avatar { width: 64rpx; height: 64rpx; border-radius: 50%; margin-right: 16rpx; background: #eee; }
.comment-body { flex: 1; }
.comment-nick { font-size: 26rpx; color: #4A90D9; display: block; }
.comment-text { font-size: 28rpx; color: #333; margin: 8rpx 0; display: block; }
.comment-time { font-size: 22rpx; color: #999; display: block; }
.empty-comment { text-align: center; padding: 40rpx; color: #999; font-size: 26rpx; }
.comment-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; align-items: center; padding: 16rpx 24rpx;
  background: #fff; border-top: 1rpx solid #eee;
}
.comment-input { flex: 1; border: 1rpx solid #e0e0e0; border-radius: 32rpx; padding: 16rpx 24rpx; font-size: 28rpx; }
.btn-send { width: 120rpx; background: #4A90D9; color: #fff; border: none; border-radius: 32rpx; font-size: 26rpx; margin-left: 16rpx; padding: 16rpx 0; }
.btn-send[disabled] { opacity: 0.5; }
.disabled-bar { justify-content: center; }
.disabled-text { color: #999; font-size: 26rpx; }
</style>
