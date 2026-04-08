<template>
  <view class="bell-wrap" @click="togglePanel">
    <text class="bell-icon">&#x1F514;</text>
    <view v-if="hasNew" class="red-dot" />
    <NotificationPanel
      v-if="showPanel"
      @close="closePanel"
      @read="onItemRead"
    />
  </view>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { getUnreadCount } from '../api/notification';
import { getSocket } from '../utils/socket';
import NotificationPanel from './NotificationPanel.vue';

const hasNew = ref(false);
const showPanel = ref(false);
let socket = null;

onMounted(() => {
  checkUnread();
  listenSocket();
});

onUnmounted(() => {
  if (socket) {
    socket.off('notification:new', onNewNotification);
  }
});

async function checkUnread() {
  try {
    const res = await getUnreadCount();
    hasNew.value = (res.data?.count || 0) > 0;
  } catch {
    // ignore
  }
}

function listenSocket() {
  socket = getSocket();
  if (socket) {
    socket.on('notification:new', onNewNotification);
  }
}

function onNewNotification() {
  hasNew.value = true;
}

function togglePanel() {
  showPanel.value = !showPanel.value;
  if (showPanel.value) {
    // 进入面板即清除入口红点
    hasNew.value = false;
  }
}

function closePanel() {
  showPanel.value = false;
}

function onItemRead() {
  // 单条已读回调，面板内部处理
}
</script>

<style scoped>
.bell-wrap {
  position: relative;
  padding: 10rpx;
  z-index: 1000;
}
.bell-icon {
  font-size: 40rpx;
}
.red-dot {
  position: absolute;
  top: 6rpx;
  right: 6rpx;
  width: 16rpx;
  height: 16rpx;
  background: #ff3b30;
  border-radius: 50%;
}
</style>
