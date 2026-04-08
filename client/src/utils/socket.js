import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3000';
let socket = null;

export function getSocket() {
  if (socket && socket.connected) return socket;

  const token = uni.getStorageSync('token');
  if (!token) return null;

  socket = io(SERVER_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  socket.on('connect', () => {
    console.log('[socket] connected:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('[socket] connect error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[socket] disconnected:', reason);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
