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
.edit-page { padding: 32rpx; background: #f7f8fa; min-height: 100vh; }
.avatar-section { display: flex; flex-direction: column; align-items: center; padding: 48rpx 0; }
.avatar {
  width: 180rpx; height: 180rpx; border-radius: 50%; background: #f0f2f5;
  border: 4rpx solid #fff; box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.08);
}
.avatar-tip { font-size: 24rpx; color: #4A90D9; margin-top: 16rpx; font-weight: 500; }
.form-group {
  background: #fff; padding: 28rpx 32rpx; margin-bottom: 2rpx;
  display: flex; align-items: center;
}
.form-group:first-of-type { border-radius: 16rpx 16rpx 0 0; }
.form-group:last-of-type { border-radius: 0 0 16rpx 16rpx; }
.label { width: 120rpx; font-size: 28rpx; color: #666; flex-shrink: 0; }
.input { flex: 1; font-size: 28rpx; color: #333; }
.btn-save {
  margin-top: 48rpx;
  background: linear-gradient(135deg, #4A90D9, #5DA0E5);
  color: #fff; border: none; border-radius: 16rpx; font-size: 30rpx;
  font-weight: 600; box-shadow: 0 8rpx 24rpx rgba(74, 144, 217, 0.3);
}
.btn-save[disabled] { opacity: 0.5; box-shadow: none; }
</style>
