<template>
  <view class="publish-page">
    <textarea
      v-model="content"
      placeholder="分享你的想法..."
      maxlength="1000"
      auto-height
      class="textarea"
    />
    <view class="char-count">
      <text>{{ content.length }}/1000</text>
    </view>
    <button class="btn-publish" :disabled="!content.trim() || loading" @click="handlePublish">
      {{ loading ? '发布中...' : '发布' }}
    </button>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { createPost } from '../../api/post';

const content = ref('');
const loading = ref(false);

async function handlePublish() {
  if (!content.value.trim()) return;
  loading.value = true;
  try {
    await createPost(content.value);
    uni.showToast({ title: '发布成功', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 500);
  } catch (e) {
    // handled
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.publish-page {
  padding: 24rpx;
  min-height: 100vh;
  background: #fff;
}
.textarea {
  width: 100%;
  min-height: 300rpx;
  font-size: 32rpx;
  line-height: 1.6;
  padding: 16rpx;
  box-sizing: border-box;
}
.char-count {
  text-align: right;
  font-size: 24rpx;
  color: #999;
  margin: 16rpx 0;
}
.btn-publish {
  background: #4A90D9;
  color: #fff;
  border: none;
  border-radius: 12rpx;
  padding: 24rpx;
  font-size: 32rpx;
}
.btn-publish[disabled] {
  opacity: 0.5;
}
</style>
