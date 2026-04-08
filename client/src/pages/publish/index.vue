<template>
  <view class="publish-page">
    <textarea
      v-model="content"
      placeholder="分享你的想法..."
      maxlength="1000"
      auto-height
      class="textarea"
    />

    <!-- 图片选择区 -->
    <view class="image-picker">
      <view v-for="(img, idx) in images" :key="idx" class="img-wrap">
        <image class="picked-img" :src="img.tempPath" mode="aspectFill" />
        <text class="img-remove" @click="removeImage(idx)">✕</text>
      </view>
      <view v-if="totalMedia < 9" class="img-add" @click="chooseImages">
        <text class="add-icon">+</text>
        <text class="add-text">图片</text>
      </view>
      <view v-if="totalMedia < 9" class="img-add" @click="chooseVideo">
        <text class="add-icon">▶</text>
        <text class="add-text">视频</text>
      </view>
    </view>

    <!-- 视频预览 -->
    <view v-if="videos.length > 0" class="video-preview">
      <view v-for="(v, idx) in videos" :key="idx" class="video-item">
        <video :src="v.tempPath" class="preview-video" controls />
        <text class="vid-remove" @click="removeVideo(idx)">✕</text>
      </view>
    </view>

    <view class="char-count">
      <text>{{ content.length }}/1000</text>
    </view>
    <button class="btn-publish" :disabled="!content.trim() || loading" @click="handlePublish">
      {{ loading ? (uploadProgress || '发布中...') : (isEdit ? '保存修改' : '发布') }}
    </button>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { createPost, editPost } from '../../api/post';

const content = ref('');
const images = ref([]);
const videos = ref([]);
const loading = ref(false);
const uploadProgress = ref('');
const isEdit = ref(false);
const editId = ref('');

onMounted(() => {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  const opts = current.$page?.options || current.options || {};
  if (opts.id) {
    isEdit.value = true;
    editId.value = opts.id;
    content.value = decodeURIComponent(opts.content || '');
    if (opts.media) {
      try {
        const urls = JSON.parse(decodeURIComponent(opts.media));
        images.value = urls.map(url => ({ tempPath: url, uploaded: true, url }));
      } catch {}
    }
    uni.setNavigationBarTitle({ title: '编辑帖子' });
  }
});

import { computed } from 'vue';

const totalMedia = computed(() => images.value.length + videos.value.length);

function chooseVideo() {
  uni.chooseVideo({
    sourceType: ['album', 'camera'],
    maxDuration: 60,
    success: (res) => {
      if (res.size > 20 * 1024 * 1024) {
        uni.showToast({ title: '视频不能超过20MB', icon: 'none' });
        return;
      }
      videos.value.push({ tempPath: res.tempFilePath, uploaded: false, url: '' });
    },
  });
}

function removeVideo(idx) {
  videos.value.splice(idx, 1);
}

function chooseImages() {
  const remaining = 9 - totalMedia.value;
  uni.chooseImage({
    count: remaining,
    sizeType: ['compressed'],
    success: (res) => {
      const newImgs = res.tempFilePaths.map(p => ({ tempPath: p, uploaded: false, url: '' }));
      images.value = [...images.value, ...newImgs].slice(0, 9);
    },
  });
}

function removeImage(idx) {
  images.value.splice(idx, 1);
}

async function uploadImages() {
  const urls = [];
  for (let i = 0; i < images.value.length; i++) {
    const img = images.value[i];
    if (img.uploaded && img.url) {
      urls.push(img.url);
      continue;
    }
    uploadProgress.value = `上传图片 ${i + 1}/${images.value.length}...`;
    const url = await new Promise((resolve, reject) => {
      uni.uploadFile({
        url: 'http://localhost:3000/api/upload/post-image',
        filePath: img.tempPath,
        name: 'file',
        header: { Authorization: `Bearer ${uni.getStorageSync('token')}` },
        success: (r) => {
          const data = JSON.parse(r.data);
          if (data.success) resolve(data.data.url);
          else reject(new Error(data.error));
        },
        fail: reject,
      });
    });
    img.uploaded = true;
    img.url = url;
    urls.push(url);
  }
  return urls;
}

async function uploadAllMedia() {
  const imgUrls = images.value.length > 0 ? await uploadImages() : [];
  const vidUrls = [];
  for (let i = 0; i < videos.value.length; i++) {
    const v = videos.value[i];
    if (v.uploaded && v.url) { vidUrls.push(v.url); continue; }
    uploadProgress.value = `上传视频 ${i + 1}/${videos.value.length}...`;
    const url = await new Promise((resolve, reject) => {
      uni.uploadFile({
        url: 'http://localhost:3000/api/upload/post-video',
        filePath: v.tempPath,
        name: 'file',
        header: { Authorization: `Bearer ${uni.getStorageSync('token')}` },
        success: (r) => {
          const data = JSON.parse(r.data);
          if (data.success) resolve(data.data.url);
          else reject(new Error(data.error));
        },
        fail: reject,
      });
    });
    v.uploaded = true;
    v.url = url;
    vidUrls.push(url);
  }
  return [...imgUrls, ...vidUrls];
}

async function handlePublish() {
  if (!content.value.trim()) return;
  loading.value = true;
  try {
    if (isEdit.value) {
      const mediaUrls = await uploadAllMedia();
      await editPost(editId.value, content.value, mediaUrls);
      uni.showToast({ title: '修改成功', icon: 'success' });
    } else {
      const mediaUrls = await uploadAllMedia();
      await createPost(content.value, mediaUrls);
      uni.showToast({ title: '发布成功', icon: 'success' });
    }
    setTimeout(() => uni.navigateBack(), 500);
  } catch {
    uni.showToast({ title: '操作失败', icon: 'none' });
  } finally {
    loading.value = false;
    uploadProgress.value = '';
  }
}
</script>

<style scoped>
.publish-page { padding: 24rpx; min-height: 100vh; background: #fff; }
.textarea { width: 100%; min-height: 300rpx; font-size: 32rpx; line-height: 1.6; padding: 16rpx; box-sizing: border-box; }
.image-picker { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 20rpx 0; }
.img-wrap { position: relative; width: 200rpx; height: 200rpx; }
.picked-img { width: 100%; height: 100%; border-radius: 8rpx; }
.img-remove { position: absolute; top: -10rpx; right: -10rpx; width: 40rpx; height: 40rpx; background: rgba(0,0,0,0.6); color: #fff; font-size: 24rpx; text-align: center; line-height: 40rpx; border-radius: 50%; }
.img-add { width: 200rpx; height: 200rpx; border: 2rpx dashed #ccc; border-radius: 8rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.add-icon { font-size: 60rpx; color: #ccc; }
.add-text { font-size: 22rpx; color: #999; }
.char-count { text-align: right; font-size: 24rpx; color: #999; margin: 16rpx 0; }
.btn-publish { background: #4A90D9; color: #fff; border: none; border-radius: 12rpx; padding: 24rpx; font-size: 32rpx; }
.btn-publish[disabled] { opacity: 0.5; }
.video-preview { margin: 16rpx 0; }
.video-item { position: relative; margin-bottom: 12rpx; }
.preview-video { width: 100%; border-radius: 8rpx; }
.vid-remove { position: absolute; top: 10rpx; right: 10rpx; width: 48rpx; height: 48rpx; background: rgba(0,0,0,0.6); color: #fff; font-size: 28rpx; text-align: center; line-height: 48rpx; border-radius: 50%; }
</style>
