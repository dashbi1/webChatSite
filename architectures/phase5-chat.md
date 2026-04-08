# Phase 5: 实时私聊

## 实现状态：后端代码已写，待测试 + 前端联调

## 对应用户故事
- US09 - 实时私聊
- US13 - 转发帖子到私聊（本阶段仅实现基础文字私聊，转发延后）

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/messages/conversations` | 获取聊天会话列表（最近消息+未读数） |
| GET | `/api/messages/:friendId?page=` | 获取与某好友的聊天记录（分页，自动标记已读） |

## Socket.io 事件

| 方向 | 事件名 | 数据 | 说明 |
|------|--------|------|------|
| 客户端→服务端 | `chat:send` | `{ receiverId, content, messageType }` | 发送消息 |
| 服务端→客户端 | `chat:receive` | `{ message }` | 收到新消息 |
| 服务端→客户端 | `chat:sent` | `{ message }` | 发送成功回执 |
| 客户端→服务端 | `chat:typing` | `{ receiverId }` | 正在输入（可选） |

## 技术实现
- **WebSocket 认证**：连接时通过 `socket.handshake.auth.token` 传递 JWT
- **个人房间**：每个用户加入以自己 user_id 为名的 room，消息通过 `io.to(receiverId)` 定向推送
- **消息持久化**：消息先存入 Supabase messages 表，再推送给接收方
- **已读标记**：获取聊天记录时自动将对方发来的消息标为已读
- **会话列表**：通过 Supabase RPC 函数 `get_conversations` 聚合最近消息+未读数

## 前端实现
- **聊天列表页** (`chat-list/index.vue`)：TabBar "消息" 入口，显示最近会话
- **聊天页** (`chat/index.vue`)：消息气泡、输入框、实时收发
- **Socket 封装** (`utils/socket.js`)：当前使用 uni.connectSocket 兼容多端

## 待确认问题

### 1. 前端 Socket.io 方案
当前 `utils/socket.js` 用的是原生 WebSocket 封装，但后端用的是 Socket.io。
两者协议不兼容，需要统一：
- **方案 A**：前端引入 `socket.io-client`（H5 直接用，小程序端后续用 `weapp.socket.io`）
- **方案 B**：后端改用原生 WebSocket（ws 库）替代 Socket.io

→ 建议方案 A，因为 Socket.io 功能更丰富（自动重连、房间等）

### 2. 离线消息
当前实现：消息存入数据库后推送，如果接收方不在线，消息仍保存在数据库。
下次上线时通过 `GET /api/messages/:friendId` 获取历史消息。
→ 不需要额外离线推送机制，现有方案够用。

### 3. 好友关系检查
当前后端 Socket.io 的 `chat:send` 没有检查发送方和接收方是否互为好友。
→ 需要补上好友关系校验。

## 测试计划
- **集成测试**：通过 HTTP API 测试消息记录和会话列表
- **Socket 测试**：用 `socket.io-client` 在测试中模拟两个客户端收发消息

## 关键文件
- `server/src/routes/messages.js` — 消息 HTTP 路由
- `server/src/socket/chatHandler.js` — Socket.io 事件处理
- `client/src/pages/chat/index.vue` — 聊天页面
- `client/src/pages/chat-list/index.vue` — 会话列表
- `client/src/utils/socket.js` — Socket 客户端封装
- `database/functions.sql` — `get_conversations` RPC 函数
