# Phase 9：热帖排行 + 转发到私聊

## 实现状态：待开发

## 对应用户故事
- US14 - 热帖排行
- US13 - 转发帖子到私聊

## 一、US14 热帖排行

### 热度算法
```
热度 = like_count * 2 + comment_count
```
按热度倒序排列，相同热度按时间倒序。

### API 变更

| 方法 | 路径 | 变更 |
|------|------|------|
| GET | `/api/posts?page=&sort=hot` | sort 参数：`latest`（默认，时间倒序）或 `hot`（热度倒序） |

后端实现：sort=hot 时 order by `(like_count * 2 + comment_count) desc, created_at desc`。
Supabase JS SDK 不支持表达式排序，改用 RPC 函数或 raw SQL view。

### 前端改动
- **首页顶部**：添加 Tab 切换 "最新" / "热门"
- 切换 Tab 时重新加载列表，传 `sort=hot` 或 `sort=latest`
- 样式：两个 Tab 居中显示，选中态下划线+加粗

## 二、US13 转发帖子到私聊

### 转发流程
1. 帖子卡片点击"转发"按钮
2. 弹出好友选择列表（复用好友列表 API）
3. 选择好友 → 发送转发消息
4. 通过 Socket.io `chat:send` 发送，messageType = 'post_share'，referencePostId = 帖子 ID

### 转发消息格式

发送时：
```json
{
  "receiverId": "friend-id",
  "content": "转发了一条帖子",
  "messageType": "post_share",
  "referencePostId": "post-id"
}
```

### 聊天页消息展示
- 普通消息：文字气泡
- 转发消息（messageType = 'post_share'）：小卡片样式
  - 卡片内容：帖子作者昵称 + 帖子内容前 50 字
  - 点击卡片 → 跳转帖子详情页

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/posts/:id` | 获取单条帖子详情（已有，用于卡片展示） |

### 数据库
- messages 表已有 `message_type` 字段（text / post_share）
- messages 表已有 `reference_post_id` 字段（外键关联 posts.id）

## 关键文件

### 新建
- `client/src/components/FriendPicker.vue` — 好友选择弹层
- `client/src/components/ShareCard.vue` — 转发消息卡片

### 修改
- `server/src/routes/posts.js` — 信息流加 sort 参数 + 单条帖子查询
- `client/src/pages/index/index.vue` — 首页加 "最新/热门" Tab
- `client/src/components/PostCard.vue` — 转发按钮触发好友选择
- `client/src/pages/chat/index.vue` — 聊天页识别并展示转发卡片

## 测试计划
- 热帖排序：热度高的排前面
- sort=latest 和 sort=hot 返回不同顺序
- 转发帖子到好友：消息 type=post_share + reference_post_id 正确
- 非好友不能转发
- 聊天页转发卡片展示正确
- 点击转发卡片跳转帖子详情
