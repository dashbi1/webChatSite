<template>
  <view class="share-card" @click="goDetail">
    <view class="card-header">
      <text class="card-label">[转发帖子]</text>
    </view>
    <view class="card-body">
      <text class="card-author">{{ post?.author?.nickname || '未知用户' }}</text>
      <text class="card-content">{{ preview }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getPostDetail } from '../api/post';

const props = defineProps({
  postId: { type: String, required: true },
});

const post = ref(null);

const preview = computed(() => {
  if (!post.value) return '加载中...';
  const c = post.value.content || '';
  return c.length > 50 ? c.slice(0, 50) + '...' : c;
});

onMounted(async () => {
  try {
    const res = await getPostDetail(props.postId);
    post.value = res.data;
  } catch {
    post.value = { content: '帖子已删除', author: { nickname: '' } };
  }
});

function goDetail() {
  uni.navigateTo({ url: `/pages/post-detail/index?id=${props.postId}` });
}
</script>

<style scoped>
.share-card {
  background: #f5f5f5; border-radius: 12rpx; padding: 16rpx 20rpx;
  border-left: 6rpx solid #4A90D9; min-width: 300rpx;
}
.card-header { margin-bottom: 8rpx; }
.card-label { font-size: 22rpx; color: #4A90D9; }
.card-body {}
.card-author { font-size: 24rpx; color: #666; display: block; margin-bottom: 4rpx; }
.card-content { font-size: 26rpx; color: #333; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
