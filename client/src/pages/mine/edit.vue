<template>
  <view class="edit-page">
    <view class="form">
      <view class="field">
        <text class="label">昵称</text>
        <input v-model="form.nickname" placeholder="2-20字符" maxlength="20" class="input" />
      </view>
      <view class="field">
        <text class="label">学院</text>
        <input v-model="form.college" placeholder="如：计算学部" class="input" />
      </view>
      <view class="field">
        <text class="label">年级</text>
        <input v-model="form.grade" placeholder="如：2024级" class="input" />
      </view>
      <button class="btn-save" :disabled="saving" @click="handleSave">
        {{ saving ? '保存中...' : '保存' }}
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { updateProfile } from '../../api/user';

const form = ref({ nickname: '', college: '', grade: '' });
const saving = ref(false);

onMounted(() => {
  const user = JSON.parse(uni.getStorageSync('user') || '{}');
  form.value.nickname = user.nickname || '';
  form.value.college = user.college || '';
  form.value.grade = user.grade || '';
});

async function handleSave() {
  if (!form.value.nickname || form.value.nickname.length < 2) {
    uni.showToast({ title: '昵称至少2字符', icon: 'none' });
    return;
  }
  saving.value = true;
  try {
    await updateProfile(form.value);
    uni.showToast({ title: '保存成功', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 500);
  } catch (e) {
    // handled
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.edit-page { min-height: 100vh; background: #f5f5f5; padding: 20rpx; }
.form { background: #fff; border-radius: 12rpx; padding: 24rpx; }
.field { margin-bottom: 30rpx; }
.label { display: block; font-size: 28rpx; color: #666; margin-bottom: 12rpx; }
.input { border: 1rpx solid #e0e0e0; border-radius: 8rpx; padding: 20rpx; font-size: 30rpx; }
.btn-save { background: #4A90D9; color: #fff; border: none; border-radius: 12rpx; padding: 24rpx; font-size: 30rpx; margin-top: 20rpx; }
</style>
