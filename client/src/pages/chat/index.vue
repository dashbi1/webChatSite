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
        <view class="msg-bubble">
          <text>{{ msg.content }}</text>
        </view>
        <image
          v-if="msg.sender_id === myId"
          class="msg-avatar"
          :src="myAvatar || '/static/default-avatar.png'"
        />
      </view>
      <view v-if="messages.length === 0" class="empty">
        <text>暂无消息，说点什么吧</text>
      </view>
    </scroll-view>

    <view class="input-bar">
      <input v-model="inputText" placeholder="输入消息..." class="msg-input" @confirm="sendMsg" />
      <button class="btn-send" :disabled="!inputText.trim()" @click="sendMsg">发送</button>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { getMessages } from '../../api/chat';
import { getSocket } from '../../utils/socket';

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
  // 不断开全局 socket，只移除本页监听
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
  } catch (e) {
    // handled
  }
}

function connectSocket() {
  socket = getSocket();
  if (!socket) return;

  socket.on('chat:receive', onReceive);
  socket.on('chat:sent', onSent);
}

function onReceive(msg) {
  if (msg.sender_id === friendId.value) {
    messages.value.push(msg);
    scrollToBottom();
  }
}

function onSent(msg) {
  if (msg.receiver_id === friendId.value) {
    messages.value.push(msg);
    scrollToBottom();
  }
}

function sendMsg() {
  if (!inputText.value.trim() || !socket) return;
  socket.emit('chat:send', {
    receiverId: friendId.value,
    content: inputText.value.trim(),
  });
  inputText.value = '';
}

function scrollToBottom() {
  nextTick(() => {
    scrollToId.value = '';
    nextTick(() => {
      scrollToId.value = `msg-${messages.value.length - 1}`;
    });
  });
}
</script>

<style scoped>
.chat-page { display: flex; flex-direction: column; height: 100vh; background: #f5f5f5; }
.msg-list { flex: 1; padding: 20rpx; }
.msg-row { display: flex; align-items: flex-start; margin-bottom: 24rpx; }
.msg-self { flex-direction: row-reverse; }
.msg-avatar { width: 72rpx; height: 72rpx; border-radius: 50%; margin: 0 16rpx; background: #eee; flex-shrink: 0; }
.msg-bubble {
  max-width: 60%;
  background: #fff;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  font-size: 28rpx;
  color: #333;
  word-break: break-all;
}
.msg-self .msg-bubble { background: #4A90D9; color: #fff; }
.input-bar {
  display: flex; align-items: center; padding: 16rpx 24rpx;
  background: #fff; border-top: 1rpx solid #eee;
}
.msg-input { flex: 1; border: 1rpx solid #e0e0e0; border-radius: 32rpx; padding: 16rpx 24rpx; font-size: 28rpx; }
.btn-send { width: 120rpx; background: #4A90D9; color: #fff; border: none; border-radius: 32rpx; font-size: 26rpx; margin-left: 16rpx; padding: 16rpx 0; }
.btn-send[disabled] { opacity: 0.5; }
.empty { text-align: center; padding: 60rpx; color: #999; font-size: 26rpx; }
</style>
