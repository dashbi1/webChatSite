// Socket.io 客户端封装
// H5 端直接使用 socket.io-client
// 小程序端需要用 weapp.socket.io（后续适配）

let socketInstance = null;

export default function connectSocket(token) {
  // 动态 import 避免小程序端报错
  // H5 环境下使用 socket.io-client
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  // 简易 WebSocket 封装，兼容 uni-app 多端
  const SERVER_URL = 'http://localhost:3000';

  // 尝试使用原生 WebSocket 实现简易消息收发
  const callbacks = {};

  const socket = {
    connected: false,
    ws: null,

    on(event, cb) {
      if (!callbacks[event]) callbacks[event] = [];
      callbacks[event].push(cb);
    },

    emit(event, data) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ event, data }));
      }
    },

    disconnect() {
      if (this.ws) this.ws.close();
    },
  };

  // 使用 uni.connectSocket 兼容多端
  const ws = uni.connectSocket({
    url: SERVER_URL.replace('http', 'ws') + `?token=${token}`,
    success() {},
  });

  ws.onOpen(() => {
    socket.connected = true;
    socket.ws = ws;
    // 发送认证
    ws.send({ data: JSON.stringify({ event: 'auth', data: { token } }) });
  });

  ws.onMessage((res) => {
    try {
      const msg = JSON.parse(res.data);
      const cbs = callbacks[msg.event] || [];
      cbs.forEach(cb => cb(msg.data));
    } catch (e) {
      // ignore
    }
  });

  ws.onClose(() => {
    socket.connected = false;
  });

  socketInstance = socket;
  return socket;
}
