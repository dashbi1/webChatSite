# Phase 6: 站内通知系统

## 实现状态：待开发

## 对应用户故事
- US12 - 站内通知

## 通知触发场景

| 触发事件 | 通知内容示例 | 跳转目标 |
|---------|-------------|---------|
| 收到好友申请 | "张三 向你发送了好友申请" | 好友申请页 |
| 收到私聊消息（不在对应聊天页时） | "李四：你好，最近怎么样..." | 与李四的聊天页 |

## 前端交互设计

### 通知入口
- **位置**：每个 TabBar 页面右上角的铃铛图标
- **红点逻辑**：
  - 有未查看的新通知时显示红点
  - 点击铃铛进入通知面板后，红点消失（不需要逐条点击）
  - 新通知到达时红点重新出现
- **全局可见**：首页、好友、消息、我的 四个 tab 页都有

### 通知面板
- **样式**：半屏下拉浮层，覆盖在当前页面上方
- **内容**：全部通知（已读+未读），按时间倒序
- **滚动**：可上下滑动，分页加载（每次 20 条）
- **每条通知**：
  - 未读通知右侧有红色小圆点
  - 点击通知 → 标记该条为已读 → 跳转到对应页面
  - 私聊通知显示消息前 20 字预览

### 红点状态管理
- 本地维护 `lastViewedAt` 时间戳（存 Storage）
- 进入通知面板时更新 `lastViewedAt`
- 入口红点逻辑：有通知的 `created_at > lastViewedAt` 时显示
- 每条通知的红点逻辑：`is_read === false` 时显示

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notifications?page=&limit=` | 获取通知列表（分页，时间倒序） |
| PUT | `/api/notifications/:id/read` | 标记单条通知为已读 |
| GET | `/api/notifications/unread-count` | 获取未读通知数量（用于红点判断） |

## Socket.io 实时推送

| 方向 | 事件名 | 数据 | 说明 |
|------|--------|------|------|
| 服务端→客户端 | `notification:new` | `{ notification }` | 新通知实时推送 |

触发时机：
- 好友申请创建后 → 通知接收方
- 私聊消息存入后 → 如果接收方不在对应聊天页 → 通知

### 私聊通知去重
- 后端发消息时，通过 Socket.io 的房间检查接收方是否在线
- 是否"在聊天页"的判断由前端控制：前端收到 `chat:receive` 时如果正在对应聊天页，就不弹通知
- 后端统一发 `notification:new`，前端自行过滤

## 技术实现

### 后端
- 好友申请路由（friends.js）：创建 friendship 后，insert 一条通知 + socket 推送
- 聊天处理（chatHandler.js）：发消息后，insert 一条通知 + socket 推送
- 通知路由（notifications.js）：列表查询 + 标记已读 + 未读数

### 前端
- **NotificationBell 组件**：铃铛图标+红点，放在每个 tab 页的导航栏
- **NotificationPanel 组件**：半屏浮层，通知列表
- **全局状态**：用一个响应式变量 `hasNewNotification` 控制红点显示
- **Socket 监听**：在 App.vue 或 tab 页层级监听 `notification:new`

## 关键文件（待创建/修改）
- `server/src/routes/notifications.js` — 修改，完善通知 API
- `server/src/routes/friends.js` — 修改，添加通知触发
- `server/src/socket/chatHandler.js` — 修改，添加通知触发
- `client/src/components/NotificationBell.vue` — 新建，铃铛组件
- `client/src/components/NotificationPanel.vue` — 新建，通知面板
- `client/src/pages/index/index.vue` — 修改，加入通知铃铛
- `client/src/pages/friends/index.vue` — 修改，加入通知铃铛
- `client/src/pages/chat-list/index.vue` — 修改，加入通知铃铛
- `client/src/pages/mine/index.vue` — 修改，加入通知铃铛

## 测试计划
- 好友申请 → 通知生成
- 私聊消息 → 通知生成
- 获取通知列表（分页、排序）
- 标记已读
- 未读数接口
- Socket 实时推送通知
