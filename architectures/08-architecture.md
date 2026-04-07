# 工大圈子 - 系统架构设计

## 体系结构总览

```
┌─────────────────────────────────────────────────────┐
│                     客户端 (uni-app)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Web H5   │  │ Android  │  │ 微信小程序        │   │
│  │ (浏览器)  │  │ App      │  │ (最后实现)        │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└───────────────────────┬─────────────────────────────┘
                        │ HTTPS / WSS
                        ↓
┌─────────────────────────────────────────────────────┐
│                   VPS (2C4G)                         │
│  ┌─────────────────────────────────────────────┐    │
│  │              Nginx (反向代理)                 │    │
│  │  - 静态资源托管 (H5)                          │    │
│  │  - API 请求转发 → Node 服务                    │    │
│  │  - WebSocket 转发                             │    │
│  │  - SSL 终止                                   │    │
│  └─────────────────┬───────────────────────────┘    │
│                    ↓                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │          Node.js 后端服务                     │    │
│  │  ┌───────────┐  ┌────────────────────┐      │    │
│  │  │ Express   │  │ Socket.io Server   │      │    │
│  │  │ REST API  │  │ (实时私聊/通知)      │      │    │
│  │  └─────┬─────┘  └────────┬───────────┘      │    │
│  │        │                 │                    │    │
│  │        ↓                 ↓                    │    │
│  │  ┌─────────────────────────────┐             │    │
│  │  │     业务逻辑层               │             │    │
│  │  │  - 用户服务                  │             │    │
│  │  │  - 帖子服务                  │             │    │
│  │  │  - 好友服务                  │             │    │
│  │  │  - 聊天服务                  │             │    │
│  │  │  - 通知服务                  │             │    │
│  │  │  - 管理服务                  │             │    │
│  │  └─────────────┬───────────────┘             │    │
│  │                ↓                              │    │
│  │  ┌─────────────────────────────┐             │    │
│  │  │  Supabase JS Client         │             │    │
│  │  └─────────────┬───────────────┘             │    │
│  └────────────────┼──────────────────────────────┘   │
└───────────────────┼──────────────────────────────────┘
                    ↓ HTTPS
┌─────────────────────────────────────────────────────┐
│              Supabase 云服务 (免费套餐)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │PostgreSQL│  │ Auth     │  │ Storage          │   │
│  │ 数据库    │  │ 认证服务  │  │ 文件存储          │   │
│  │          │  │ (JWT)    │  │ (头像/图片/视频)  │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 技术栈详细

| 组件 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| 前端框架 | uni-app + Vue 3 | 最新 | HBuilderX 开发 |
| UI 组件库 | uni-ui / uView | 最新 | uni-app 生态组件库 |
| 状态管理 | Pinia | 最新 | Vue 3 官方推荐 |
| 后端框架 | Express.js | 4.x | 轻量级 Node.js 框架 |
| 实时通信 | Socket.io | 4.x | WebSocket 封装 |
| 数据库 | PostgreSQL (Supabase) | 15+ | 云端托管 |
| ORM/Client | @supabase/supabase-js | 2.x | Supabase 官方 SDK |
| 认证 | Supabase Auth + JWT | - | 手机号+验证码 |
| 文件存储 | Supabase Storage | - | 图片、视频、头像 |
| 反向代理 | Nginx | 最新 | SSL + 静态资源 + 转发 |
| 进程管理 | PM2 | 最新 | Node 服务守护 |

## 数据库设计（初步）

### 核心表

```
users
├── id (UUID, PK)
├── phone (手机号, UNIQUE)
├── nickname (昵称)
├── avatar_url (头像URL)
├── college (学院)
├── grade (年级)
├── role (enum: user/admin)
├── status (enum: active/banned)
├── created_at
└── updated_at

posts
├── id (UUID, PK)
├── author_id (FK → users.id)
├── content (文字内容)
├── media_urls (JSON, 图片/视频URL数组)
├── media_type (enum: none/image/video)
├── like_count (点赞计数, 冗余)
├── comment_count (评论计数, 冗余)
├── is_edited (是否编辑过)
├── created_at
└── updated_at

friendships
├── id (UUID, PK)
├── requester_id (FK → users.id, 发起方)
├── addressee_id (FK → users.id, 接收方)
├── status (enum: pending/accepted/rejected)
├── created_at
└── updated_at

likes
├── id (UUID, PK)
├── user_id (FK → users.id)
├── post_id (FK → posts.id)
├── created_at
└── UNIQUE(user_id, post_id)

comments
├── id (UUID, PK)
├── user_id (FK → users.id)
├── post_id (FK → posts.id)
├── content (评论内容)
├── created_at
└── updated_at

messages (私聊消息)
├── id (UUID, PK)
├── sender_id (FK → users.id)
├── receiver_id (FK → users.id)
├── content (消息内容)
├── message_type (enum: text/post_share)
├── reference_post_id (FK → posts.id, 转发时引用)
├── is_read (是否已读)
├── created_at
└── INDEX(sender_id, receiver_id, created_at)

notifications
├── id (UUID, PK)
├── user_id (FK → users.id, 接收人)
├── type (enum: friend_request/like/comment/system)
├── content (通知内容)
├── reference_id (关联的故事/帖子/用户 ID)
├── is_read (是否已读)
├── created_at
└── INDEX(user_id, is_read, created_at)

reports (举报)
├── id (UUID, PK)
├── reporter_id (FK → users.id)
├── target_type (enum: post/user)
├── target_id (被举报的帖子或用户 ID)
├── reason (举报原因)
├── status (enum: pending/resolved/dismissed)
├── created_at
└── UNIQUE(reporter_id, target_type, target_id)
```

## API 路由设计（初步）

```
# 认证
POST   /api/auth/send-code      # 发送验证码
POST   /api/auth/register        # 注册
POST   /api/auth/login           # 登录

# 用户
GET    /api/users/me             # 获取当前用户信息
PUT    /api/users/me             # 更新个人资料
GET    /api/users/search?q=      # 搜索用户
GET    /api/users/:id            # 查看用户资料

# 帖子
GET    /api/posts                # 获取信息流（分页）
POST   /api/posts                # 发布帖子
PUT    /api/posts/:id            # 编辑帖子
DELETE /api/posts/:id            # 删除帖子
GET    /api/posts/hot            # 热帖排行

# 互动
POST   /api/posts/:id/like      # 点赞/取消点赞
GET    /api/posts/:id/comments   # 获取评论列表
POST   /api/posts/:id/comments   # 发表评论

# 好友
POST   /api/friends/request      # 发送好友申请
GET    /api/friends/requests      # 获取好友申请列表
PUT    /api/friends/request/:id   # 处理好友申请（接受/拒绝）
GET    /api/friends               # 获取好友列表
DELETE /api/friends/:id           # 删除好友

# 私聊
GET    /api/messages/:friendId    # 获取与某好友的聊天记录
# 实时消息通过 Socket.io 收发

# 通知
GET    /api/notifications         # 获取通知列表
PUT    /api/notifications/read    # 标记已读

# 举报
POST   /api/reports               # 提交举报

# 管理员
GET    /api/admin/users           # 用户管理列表
PUT    /api/admin/users/:id/ban   # 封禁用户
PUT    /api/admin/users/:id/unban # 解封用户
DELETE /api/admin/posts/:id       # 删除帖子
GET    /api/admin/reports         # 查看举报列表
PUT    /api/admin/reports/:id     # 处理举报

# 文件上传
POST   /api/upload/image          # 上传图片
POST   /api/upload/video          # 上传视频
```

## Socket.io 事件设计

```
# 客户端 → 服务端
chat:send        { receiverId, content, messageType, referencePostId? }
chat:typing      { receiverId }

# 服务端 → 客户端
chat:receive     { message }
chat:typing      { senderId }
notification:new { notification }
```
