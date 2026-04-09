<template>
  <view class="post-card" @click="goDetail">
    <view class="post-header">
      <image
        class="avatar"
        :src="post.author?.avatar_url || '/static/default-avatar.png'"
        mode="aspectFill"
        @click.stop="goProfile"
      />
      <view class="header-info">
        <text class="nickname">{{ post.author?.nickname || '匿名用户' }}</text>
        <view class="meta-row">
          <text class="time">{{ formatTime(post.created_at) }}</text>
          <text v-if="post.is_edited" class="edited-tag">已编辑</text>
        </view>
      </view>
      <text class="more-btn" @click.stop="showActions">
        <text class="dot" /><text class="dot" /><text class="dot" />
      </text>
    </view>

    <view class="post-body">
      <text class="post-content">{{ post.content }}</text>
    </view>

    <!-- 媒体展示 -->
    <view v-if="videoUrls.length > 0" class="video-wrap">
      <video
        v-for="(url, idx) in videoUrls"
        :key="'v'+idx"
        class="post-video"
        :src="url"
        controls
        :show-fullscreen-btn="true"
        object-fit="contain"
        @click.stop
      />
    </view>
    <view v-if="imageUrls.length > 0" class="image-grid" :class="'grid-' + Math.min(imageUrls.length, 3)">
      <image
        v-for="(url, idx) in imageUrls"
        :key="'i'+idx"
        class="post-img"
        :src="url"
        mode="aspectFill"
        lazy-load
        @click.stop="previewImage(idx)"
      />
    </view>

    <view class="post-actions">
      <view
        class="action-item"
        :class="{ liked: post.is_liked, disabled: !canInteract }"
        @click.stop="handleLike"
      >
        <text class="action-icon">{{ post.is_liked ? '♥' : '♡' }}</text>
        <text class="action-num">{{ post.like_count || 0 }}</text>
      </view>
      <view
        class="action-item"
        :class="{ disabled: !canInteract }"
        @click.stop="goDetail"
      >
        <text class="action-icon">&#x1F4AC;</text>
        <text class="action-num">{{ post.comment_count || 0 }}</text>
      </view>
      <view class="action-item" @click.stop="handleShare">
        <text class="action-icon">&#x21AA;</text>
        <text class="action-num">转发</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { toggleLike, deletePost } from '../api/post';
import { submitReport } from '../api/report';

const props = defineProps({
  post: { type: Object, required: true },
});

const emit = defineEmits(['refresh', 'share']);

const canInteract = computed(() => props.post.is_friend || props.post.is_self);
const allMedia = computed(() => {
  const urls = props.post.media_urls;
  if (!urls) return [];
  if (Array.isArray(urls)) return urls;
  try { return JSON.parse(urls); } catch { return []; }
});

function isVideo(url) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('/post-videos/');
}

const imageUrls = computed(() => allMedia.value.filter(u => !isVideo(u)));
const videoUrls = computed(() => allMedia.value.filter(u => isVideo(u)));
const images = allMedia;

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
  } catch {}
}

function showActions() {
  const isSelf = props.post.is_self;
  const items = isSelf ? ['编辑', '删除'] : ['举报'];
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (isSelf) {
        if (res.tapIndex === 0) {
          const mediaParam = images.value.length > 0 ? `&media=${encodeURIComponent(JSON.stringify(images.value))}` : '';
          uni.navigateTo({
            url: `/pages/publish/index?id=${props.post.id}&content=${encodeURIComponent(props.post.content)}${mediaParam}`,
          });
        } else if (res.tapIndex === 1) {
          uni.showModal({
            title: '确认删除',
            content: '删除后不可恢复',
            success: async (r) => {
              if (r.confirm) {
                try {
                  await deletePost(props.post.id);
                  uni.showToast({ title: '已删除', icon: 'success' });
                  emit('refresh');
                } catch {}
              }
            },
          });
        }
      } else {
        reportPost();
      }
    },
  });
}

function reportPost() {
  uni.showActionSheet({
    itemList: ['内容违规', '垃圾广告', '人身攻击', '其他'],
    success: async (res) => {
      const reasons = ['内容违规', '垃圾广告', '人身攻击', '其他'];
      try {
        await submitReport({ target_type: 'post', target_id: props.post.id, reason: reasons[res.tapIndex] });
        uni.showToast({ title: '举报已提交', icon: 'success' });
      } catch {}
    },
  });
}

function previewImage(idx) {
  uni.previewImage({ urls: imageUrls.value, current: idx });
}

function goDetail() {
  uni.navigateTo({ url: `/pages/post-detail/index?id=${props.post.id}` });
}

function goProfile() {
  uni.navigateTo({ url: `/pages/user-profile/index?id=${props.post.author_id}` });
}

function handleShare() {
  emit('share', props.post);
}
</script>

<style scoped>
.post-card {
  background: #fff;
  padding: 28rpx 32rpx;
  margin-bottom: 16rpx;
  border-radius: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
}
.post-header { display: flex; align-items: center; margin-bottom: 20rpx; }
.avatar {
  width: 84rpx; height: 84rpx; border-radius: 50%;
  margin-right: 20rpx; background: #f0f2f5;
  border: 2rpx solid rgba(74, 144, 217, 0.1);
}
.header-info { flex: 1; }
.nickname { display: block; font-size: 30rpx; font-weight: 600; color: #1a1a2e; }
.meta-row { display: flex; align-items: center; gap: 12rpx; margin-top: 4rpx; }
.time { font-size: 24rpx; color: #b0b0b0; }
.edited-tag {
  font-size: 20rpx; color: #4A90D9; background: #EBF3FC;
  padding: 2rpx 12rpx; border-radius: 8rpx;
}
.more-btn {
  display: flex; gap: 4rpx; padding: 16rpx; align-items: center;
}
.dot {
  display: inline-block; width: 6rpx; height: 6rpx;
  background: #c0c0c0; border-radius: 50%;
}

.post-body { margin-bottom: 20rpx; }
.post-content { font-size: 28rpx; line-height: 1.7; color: #333; word-break: break-all; }

.image-grid { display: flex; flex-wrap: wrap; gap: 8rpx; margin-bottom: 20rpx; }
.post-img { border-radius: 12rpx; background: #f0f2f5; }
.grid-1 .post-img { width: 100%; max-height: 500rpx; }
.grid-2 .post-img { width: calc(50% - 4rpx); height: 300rpx; }
.grid-3 .post-img { width: calc(33.33% - 6rpx); height: 220rpx; }
.video-wrap { margin-bottom: 20rpx; }
.post-video { width: 100%; border-radius: 12rpx; }

.post-actions {
  display: flex; padding-top: 16rpx;
  border-top: 1rpx solid #f5f5f5;
}
.action-item {
  flex: 1; display: flex; align-items: center; justify-content: center;
  gap: 8rpx; padding: 8rpx 0;
}
.action-icon { font-size: 28rpx; }
.action-num { font-size: 24rpx; color: #999; }
.action-item.liked .action-icon { color: #e74c3c; }
.action-item.liked .action-num { color: #e74c3c; }
.action-item.disabled .action-icon { color: #ddd; }
.action-item.disabled .action-num { color: #ddd; }
</style>
