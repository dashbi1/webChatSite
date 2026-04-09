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
      <view class="comment-input-wrap">
        <input v-model="commentText" placeholder="写评论..." class="comment-input" @confirm="handleComment" />
      </view>
      <view class="send-btn" :class="{ active: commentText.trim() }" @click="handleComment">
        <text class="send-icon">&#x27A4;</text>
      </view>
    </view>
    <view v-else class="comment-bar disabled-bar">
      <text class="disabled-text">添加好友后才能评论</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getComments, addComment, getPostDetail } from '../../api/post';
import PostCard from '../../components/PostCard.vue';

const post = ref(null);
const comments = ref([]);
const commentText = ref('');
const postId = ref('');
let pollTimer = null;

const canInteract = computed(() => post.value?.is_friend || post.value?.is_self);

onMounted(() => {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  postId.value = current.$page?.options?.id || current.options?.id;
  loadPost();
  loadComments();
  // 15 秒轮询评论
  pollTimer = setInterval(() => { loadComments(); }, 15000);
});

onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
});

async function loadPost() {
  try {
    const res = await getPostDetail(postId.value);
    post.value = res.data;
  } catch {}
}

async function loadComments() {
  try {
    const res = await getComments(postId.value);
    comments.value = res.data;
  } catch {}
}

async function handleComment() {
  if (!commentText.value.trim()) return;
  const text = commentText.value.trim();
  commentText.value = '';

  // 乐观更新：立即追加到本地
  const me = JSON.parse(uni.getStorageSync('user') || '{}');
  comments.value.push({
    id: 'temp-' + Date.now(),
    content: text,
    created_at: new Date().toISOString(),
    user: { id: me.id, nickname: me.nickname, avatar_url: me.avatar_url },
  });

  try {
    await addComment(postId.value, text);
    // 重新拉取真实数据
    loadComments();
    loadPost();
  } catch {
    // 失败时回滚
    comments.value = comments.value.filter(c => !String(c.id).startsWith('temp-'));
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
.detail-page { min-height: 100vh; background: #f7f8fa; padding-bottom: 120rpx; }
.comments-section {
  background: #fff; margin: 16rpx 24rpx; padding: 28rpx;
  border-radius: 20rpx; box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.section-title { font-size: 30rpx; font-weight: 600; color: #1a1a2e; margin-bottom: 20rpx; display: block; }
.comment-item { display: flex; padding: 20rpx 0; border-bottom: 1rpx solid #f5f5f5; }
.comment-item:last-child { border-bottom: none; }
.comment-avatar { width: 68rpx; height: 68rpx; border-radius: 50%; margin-right: 16rpx; background: #f0f2f5; flex-shrink: 0; }
.comment-body { flex: 1; }
.comment-nick { font-size: 26rpx; color: #4A90D9; font-weight: 500; display: block; }
.comment-text { font-size: 28rpx; color: #333; margin: 8rpx 0; display: block; line-height: 1.6; }
.comment-time { font-size: 22rpx; color: #ccc; display: block; }
.empty-comment { text-align: center; padding: 48rpx; color: #ccc; font-size: 26rpx; }

.comment-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; align-items: center; padding: 16rpx 24rpx 24rpx;
  background: #fff; gap: 16rpx;
  box-shadow: 0 -2rpx 8rpx rgba(0,0,0,0.04);
}
.comment-input-wrap { flex: 1; background: #f7f8fa; border-radius: 40rpx; padding: 0 24rpx; }
.comment-input { font-size: 28rpx; padding: 20rpx 0; }
.send-btn {
  width: 80rpx; height: 80rpx; border-radius: 50%;
  background: #e0e0e0; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.send-btn.active { background: linear-gradient(135deg, #4A90D9, #5DA0E5); }
.send-icon { font-size: 32rpx; color: #fff; }
.disabled-bar { justify-content: center; }
.disabled-text { color: #b0b0b0; font-size: 26rpx; }
</style>
