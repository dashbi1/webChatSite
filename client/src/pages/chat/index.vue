<template>
  <view class="chat-page">
    <scroll-view scroll-y class="msg-list" :scroll-into-view="scrollToId">
      <view
        v-for="(msg, idx) in messages"
        :key="msg.id || idx"
        :id="'msg-' + idx"
        class="msg-row"
        :class="{ 'msg-self': msg.sender_id === myId }"
      >
        <image
          v-if="msg.sender_id !== myId"
          class="msg-avatar"
          :src="msg.sender?.avatar_url || '/static/default-avatar.png'"
        />
        <view class="msg-bubble" :class="{ 'bubble-self': msg.sender_id === myId }">
          <ShareCard v-if="msg.message_type === 'post_share' && msg.reference_post_id" :postId="msg.reference_post_id" />
          <text v-else class="msg-text">{{ msg.content }}</text>
        </view>
        <image
          v-if="msg.sender_id === myId"
          class="msg-avatar"
          :src="myAvatar || '/static/default-avatar.png'"
        />
      </view>
      <view v-if="messages.length === 0" class="empty-chat">
        <text class="empty-icon">&#x1F44B;</text>
        <text class="empty-text">打个招呼吧</text>
      </view>
    </scroll-view>

    <view class="input-bar">
      <view class="input-wrap">
        <input v-model="inputText" placeholder="输入消息..." class="msg-input" @confirm="sendMsg" />
      </view>
      <view class="send-btn" :class="{ active: inputText.trim() }" @click="sendMsg">
        <text class="send-icon">&#x27A4;</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { getMessages } from '../../api/chat';
import { getSocket } from '../../utils/socket';
import ShareCard from '../../components/ShareCard.vue';

const messages = ref([]);
const inputText = ref('');
const friendId = ref('');
const friendName = ref('');
const myId = ref('');
const myAvatar = ref('');
const scrollToId = ref('');
let socket = null;

onMounted(() => {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  const opts = current.$page?.options || current.options || {};
  friendId.value = opts.friendId;
  friendName.value = decodeURIComponent(opts.name || '聊天');
  uni.setNavigationBarTitle({ title: friendName.value });
  const user = JSON.parse(uni.getStorageSync('user') || '{}');
  myId.value = user.id;
  myAvatar.value = user.avatar_url;
  loadMessages();
  connectSocket();
});

onUnmounted(() => {
  if (socket) {
    socket.off('chat:receive', onReceive);
    socket.off('chat:sent', onSent);
  }
});

async function loadMessages() {
  try {
    const res = await getMessages(friendId.value);
    messages.value = res.data || [];
    scrollToBottom();
  } catch {}
}

function connectSocket() {
  socket = getSocket();
  if (!socket) return;
  socket.on('chat:receive', onReceive);
  socket.on('chat:sent', onSent);
}

function onReceive(msg) {
  if (msg.sender_id === friendId.value) { messages.value.push(msg); scrollToBottom(); }
}
function onSent(msg) {
  if (msg.receiver_id === friendId.value) { messages.value.push(msg); scrollToBottom(); }
}

function sendMsg() {
  if (!inputText.value.trim() || !socket) return;
  socket.emit('chat:send', { receiverId: friendId.value, content: inputText.value.trim() });
  inputText.value = '';
}

function scrollToBottom() {
  nextTick(() => { scrollToId.value = ''; nextTick(() => { scrollToId.value = `msg-${messages.value.length - 1}`; }); });
}
</script>

<style scoped>
.chat-page { display: flex; flex-direction: column; height: 100vh; background: #f0f2f5; }
.msg-list { flex: 1; padding: 24rpx 20rpx; }

.msg-row { display: flex; align-items: flex-end; margin-bottom: 28rpx; }
.msg-self { flex-direction: row-reverse; }

.msg-avatar {
  width: 76rpx; height: 76rpx; border-radius: 50%;
  margin: 0 16rpx; background: #e8eaed; flex-shrink: 0;
}

.msg-bubble {
  max-width: 65%; padding: 24rpx 28rpx;
  background: #fff; color: #333;
  border-radius: 24rpx 24rpx 24rpx 8rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.04);
}
.bubble-self {
  background: linear-gradient(135deg, #4A90D9, #5DA0E5);
  color: #fff;
  border-radius: 24rpx 24rpx 8rpx 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(74, 144, 217, 0.2);
}
.msg-text { font-size: 28rpx; line-height: 1.6; word-break: break-all; }

.input-bar {
  display: flex; align-items: center; padding: 16rpx 20rpx 24rpx;
  background: #fff; gap: 16rpx;
  box-shadow: 0 -2rpx 8rpx rgba(0,0,0,0.04);
}
.input-wrap {
  flex: 1; background: #f7f8fa; border-radius: 40rpx; padding: 0 24rpx;
}
.msg-input { font-size: 28rpx; padding: 20rpx 0; }
.send-btn {
  width: 80rpx; height: 80rpx; border-radius: 50%;
  background: #e0e0e0; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.2s;
}
.send-btn.active { background: linear-gradient(135deg, #4A90D9, #5DA0E5); }
.send-icon { font-size: 32rpx; color: #fff; }

.empty-chat {
  display: flex; flex-direction: column; align-items: center;
  padding: 120rpx 0; gap: 12rpx;
}
.empty-icon { font-size: 64rpx; }
.empty-text { font-size: 26rpx; color: #b0b0b0; }
</style>
