<template>
  <view class="appeals-page">
    <view class="form-card">
      <view class="form-title">提交申诉</view>
      <view class="form-hint">若您认为您的账号被误伤，请详细说明情况。7 天内最多申诉 3 次。</view>

      <view class="field">
        <text class="label">联系邮箱</text>
        <input v-model="email" class="input" placeholder="用于接收处理结果" />
      </view>

      <view class="field">
        <text class="label">申诉理由（至少 10 字）</text>
        <textarea
          v-model="reason"
          class="textarea"
          placeholder="请描述账号被限制的时间、您的使用场景，以及认为被误伤的理由。"
          maxlength="500"
        />
        <text class="count">{{ reason.length }} / 500</text>
      </view>

      <button class="submit-btn" :disabled="submitting" @click="submit">
        {{ submitting ? '提交中...' : '提交申诉' }}
      </button>
    </view>

    <view v-if="history.length > 0" class="history-card">
      <view class="form-title">我的申诉历史</view>
      <view v-for="item in history" :key="item.id" class="history-item">
        <view class="history-meta">
          <text class="history-time">{{ formatTime(item.created_at) }}</text>
          <text class="status-badge" :class="'status-' + item.status">{{ statusLabel(item.status) }}</text>
        </view>
        <view class="history-reason">{{ item.reason }}</view>
        <view v-if="item.admin_note" class="history-note">管理员回复：{{ item.admin_note }}</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { submitAppeal, getMyAppeals } from '@/api/appeals';

const email = ref('');
const reason = ref('');
const submitting = ref(false);
const history = ref([]);

function statusLabel(s) {
  if (s === 'pending') return '处理中';
  if (s === 'approved') return '已通过';
  if (s === 'rejected') return '已拒绝';
  if (s === 'withdrawn') return '已撤回';
  return s;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString();
  } catch (e) {
    return '';
  }
}

async function loadHistory() {
  try {
    const res = await getMyAppeals();
    history.value = (res && res.data) || [];
  } catch (e) {
    // request.js 已 toast
  }
}

async function submit() {
  if (submitting.value) return;
  if (!email.value || !email.value.includes('@')) {
    uni.showToast({ title: '请填写有效邮箱', icon: 'none' });
    return;
  }
  if (!reason.value || reason.value.trim().length < 10) {
    uni.showToast({ title: '请详细描述申诉理由（至少 10 字）', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await submitAppeal({ contact_email: email.value.trim(), reason: reason.value.trim() });
    uni.showToast({ title: '申诉已提交', icon: 'success' });
    reason.value = '';
    await loadHistory();
  } catch (e) {
    // request.js 已 toast（含 COMING_SOON / RATE_LIMITED）
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  try {
    const u = uni.getStorageSync('user');
    if (u && u.email) email.value = u.email;
  } catch (e) {
    /* empty */
  }
  loadHistory();
});
</script>

<style scoped>
.appeals-page {
  padding: 24rpx;
  min-height: 100vh;
  background: #f5f5f5;
}
.form-card,
.history-card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}
.form-title {
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 12rpx;
  color: #333;
}
.form-hint {
  font-size: 24rpx;
  color: #888;
  margin-bottom: 24rpx;
  line-height: 1.6;
}
.field {
  margin-bottom: 24rpx;
}
.label {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 8rpx;
}
.input,
.textarea {
  width: 100%;
  padding: 16rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  font-size: 28rpx;
  background: #fafafa;
  box-sizing: border-box;
}
.textarea {
  min-height: 240rpx;
}
.count {
  display: block;
  text-align: right;
  font-size: 22rpx;
  color: #999;
  margin-top: 4rpx;
}
.submit-btn {
  width: 100%;
  background: #4a90d9;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
  padding: 20rpx;
  border: none;
}
.submit-btn[disabled] {
  background: #a8c4e8;
}
.history-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.history-item:last-child {
  border-bottom: none;
}
.history-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8rpx;
}
.history-time {
  font-size: 22rpx;
  color: #999;
}
.status-badge {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 20rpx;
  color: #fff;
}
.status-pending {
  background: #f39c12;
}
.status-approved {
  background: #27ae60;
}
.status-rejected {
  background: #95a5a6;
}
.status-withdrawn {
  background: #bdc3c7;
}
.history-reason {
  font-size: 26rpx;
  color: #333;
  line-height: 1.6;
}
.history-note {
  font-size: 24rpx;
  color: #666;
  margin-top: 8rpx;
  padding: 8rpx 12rpx;
  background: #f8f9fa;
  border-radius: 8rpx;
}
</style>
