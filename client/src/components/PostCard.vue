<template>
  <view class="post-card" @click="goDetail">
    <view class="post-header">
      <image
        class="avatar"
        :src="post.author?.avatar_url || '/static/default-avatar.png'"
        mode="aspectFill"
        @click.stop="goProfile"
      />
      <view class="info">
        <text class="nickname">{{ post.author?.nickname || '匿名用户' }}</text>
        <text class="time">{{ formatTime(post.created_at) }}</text>
      </view>
      <text v-if="post.is_edited" class="edited-tag">已编辑</text>
    </view>

    <view class="post-content">
      <text>{{ post.content }}</text>
    </view>

    <view class="post-actions">
      <view
        class="action"
        :class="{ active: post.is_liked, disabled: !canInteract }"
        @click.stop="handleLike"
      >
        <text>{{ post.is_liked ? '♥' : '♡' }} {{ post.like_count || 0 }}</text>
      </view>
      <view
        class="action"
        :class="{ disabled: !canInteract }"
        @click.stop="goDetail"
      >
        <text>💬 {{ post.comment_count || 0 }}</text>
      </view>
      <view class="action" @click.stop="handleShare">
        <text>↗ 转发</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { toggleLike } from '../api/post';

const props = defineProps({
  post: { type: Object, required: true },
});

const emit = defineEmits(['refresh']);

const canInteract = computed(() => props.post.is_friend || props.post.is_self);

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

async function handleLike() {
  if (!canInteract.value) {
    uni.showToast({ title: '添加好友后才能点赞', icon: 'none' });
    return;
  }
  try {
    await toggleLike(props.post.id);
    emit('refresh');
  } catch (e) {
    // handled
  }
}

function goDetail() {
  uni.navigateTo({ url: `/pages/post-detail/index?id=${props.post.id}` });
}

function goProfile() {
  uni.navigateTo({
    url: `/pages/user-profile/index?id=${props.post.author_id}`,
  });
}

function handleShare() {
  uni.showToast({ title: '转发功能开发中', icon: 'none' });
}
</script>

<style scoped>
.post-card {
  background: #fff;
  padding: 24rpx;
  margin-bottom: 16rpx;
  border-radius: 12rpx;
}
.post-header {
  display: flex;
  align-items: center;
  margin-bottom: 16rpx;
}
.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  margin-right: 16rpx;
  background: #eee;
}
.info {
  flex: 1;
}
.nickname {
  display: block;
  font-size: 30rpx;
  font-weight: 500;
  color: #333;
}
.time {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-top: 4rpx;
}
.edited-tag {
  font-size: 22rpx;
  color: #999;
  background: #f5f5f5;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.post-content {
  font-size: 30rpx;
  line-height: 1.6;
  color: #333;
  margin-bottom: 20rpx;
}
.post-actions {
  display: flex;
  border-top: 1rpx solid #f0f0f0;
  padding-top: 16rpx;
}
.action {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: #666;
}
.action.active {
  color: #e74c3c;
}
.action.disabled {
  color: #ccc;
}
</style>
