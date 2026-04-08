<template>
  <view class="edit-page">
    <view class="avatar-section" @click="changeAvatar">
      <image class="avatar" :src="form.avatar_url || '/static/default-avatar.png'" />
      <text class="avatar-tip">点击更换头像</text>
    </view>

    <view class="form-group">
      <text class="label">昵称</text>
      <input v-model="form.nickname" placeholder="请输入昵称" maxlength="20" class="input" />
    </view>

    <view class="form-group">
      <text class="label">学院</text>
      <input v-model="form.college" placeholder="请输入学院" class="input" />
    </view>

    <view class="form-group">
      <text class="label">年级</text>
      <input v-model="form.grade" placeholder="如：2023级" class="input" />
    </view>

    <button class="btn-save" :disabled="saving" @click="save">
      {{ saving ? '保存中...' : '保存' }}
    </button>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getMe, updateProfile as updateMe } from '../../api/user';

const form = ref({ nickname: '', college: '', grade: '', avatar_url: '' });
const saving = ref(false);

onMounted(async () => {
  try {
    const res = await getMe();
    const u = res.data;
    form.value = {
      nickname: u.nickname || '',
      college: u.college || '',
      grade: u.grade || '',
      avatar_url: u.avatar_url || '',
    };
  } catch {}
});

function changeAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: async (res) => {
      const tempPath = res.tempFilePaths[0];
      uni.showLoading({ title: '上传中...' });
      try {
        const uploadRes = await new Promise((resolve, reject) => {
          uni.uploadFile({
            url: 'http://localhost:3000/api/upload/avatar',
            filePath: tempPath,
            name: 'file',
            header: {
              Authorization: `Bearer ${uni.getStorageSync('token')}`,
            },
            success: (r) => {
              const data = JSON.parse(r.data);
              if (data.success) resolve(data);
              else reject(new Error(data.error));
            },
            fail: reject,
          });
        });
        form.value.avatar_url = uploadRes.data.avatar_url;
        uni.showToast({ title: '头像已更新', icon: 'success' });
      } catch (e) {
        uni.showToast({ title: '上传失败', icon: 'none' });
      } finally {
        uni.hideLoading();
      }
    },
  });
}

async function save() {
  if (!form.value.nickname.trim()) {
    uni.showToast({ title: '昵称不能为空', icon: 'none' });
    return;
  }
  saving.value = true;
  try {
    await updateMe({
      nickname: form.value.nickname.trim(),
      college: form.value.college.trim(),
      grade: form.value.grade.trim(),
    });
    // 更新本地缓存
    const user = JSON.parse(uni.getStorageSync('user') || '{}');
    Object.assign(user, form.value);
    uni.setStorageSync('user', JSON.stringify(user));
    uni.showToast({ title: '保存成功', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 500);
  } catch {
    uni.showToast({ title: '保存失败', icon: 'none' });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.edit-page { padding: 30rpx; background: #f5f5f5; min-height: 100vh; }
.avatar-section { display: flex; flex-direction: column; align-items: center; padding: 40rpx 0; }
.avatar { width: 160rpx; height: 160rpx; border-radius: 50%; background: #eee; }
.avatar-tip { font-size: 24rpx; color: #4A90D9; margin-top: 16rpx; }
.form-group { background: #fff; padding: 24rpx; margin-bottom: 2rpx; display: flex; align-items: center; }
.label { width: 120rpx; font-size: 28rpx; color: #333; flex-shrink: 0; }
.input { flex: 1; font-size: 28rpx; }
.btn-save { margin-top: 40rpx; background: #4A90D9; color: #fff; border: none; border-radius: 12rpx; font-size: 30rpx; }
.btn-save[disabled] { opacity: 0.5; }
</style>
