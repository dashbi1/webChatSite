# 工大圈子 - 代码实现计划

> 本文件是实际编码的执行计划，面向一个人的开发节奏。
> 目标：4月19日前有可运行的系统（Lab2 报告 + PPT 第1轮成果）。

## 现状

- 今天：4月7日（第2周）
- 截止：4月19日（第3周末）= **剩余 12 天**
- 需交付：Lab2 实验报告 + PPT（含系统截图 + 5分钟演示视频）

## 关键约束

- 1 人开发，时间紧
- PPT 要求展示**可运行系统的真实截图**
- Lab2 要求至少 5 个高优先级用户故事的原型（MockPlus）
- Lab2 要求在 CodeArts 中建立项目管理计划

## 策略：先跑通再打磨

**12 天内不可能完成全部 21 个故事。** 核心策略：

1. 优先实现 PPT 展示需要的功能（能截图、能演示）
2. Lab2 报告的文字部分（用户故事、估算、迭代计划）已在 architectures/ 中准备好
3. MockPlus 原型设计可以和开发并行
4. CodeArts 项目管理可以一次性补录

### 4月19日前必须可演示的功能

| 优先级 | 功能 | 对应故事 | 说明 |
|--------|------|---------|------|
| **P0** | 注册/登录 | US07+US08 | 基础入口，没有它其他都无法展示 |
| **P0** | 信息流浏览 | US01 | 核心页面 |
| **P0** | 发布文字帖子 | US02 | 核心交互 |
| **P1** | 搜索用户+查看资料 | US10+US11 | 好友流程前置 |
| **P1** | 好友申请+处理 | US03+US04 | 社交核心 |
| **P1** | 点赞+评论 | US05+US06 | 互动核心 |
| **P2** | 私聊（基础版） | US09 | 如果时间够就做，否则用静态页面截图 |

---

## 项目结构

```
hit-circle/
├── client/                    # uni-app 前端
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index/         # 信息流首页
│   │   │   ├── login/         # 登录页
│   │   │   ├── register/      # 注册页
│   │   │   ├── publish/       # 发帖页
│   │   │   ├── post-detail/   # 帖子详情（评论）
│   │   │   ├── user-profile/  # 用户资料页
│   │   │   ├── search/        # 搜索用户
│   │   │   ├── friends/       # 好友列表
│   │   │   ├── friend-requests/ # 好友申请
│   │   │   ├── chat/          # 私聊页面
│   │   │   ├── chat-list/     # 聊天列表
│   │   │   ├── notifications/ # 通知中心
│   │   │   ├── mine/          # 个人中心
│   │   │   └── admin/         # 管理后台
│   │   ├── components/        # 公共组件
│   │   │   ├── PostCard.vue   # 帖子卡片
│   │   │   ├── UserAvatar.vue # 用户头像
│   │   │   ├── CommentItem.vue
│   │   │   └── TabBar.vue     # 底部导航
│   │   ├── store/             # Pinia 状态管理
│   │   │   ├── user.js        # 用户状态
│   │   │   ├── post.js        # 帖子状态
│   │   │   └── chat.js        # 聊天状态
│   │   ├── api/               # API 请求封装
│   │   │   ├── auth.js
│   │   │   ├── post.js
│   │   │   ├── friend.js
│   │   │   ├── chat.js
│   │   │   └── request.js     # axios/uni.request 封装
│   │   ├── utils/
│   │   ├── static/            # 静态资源
│   │   ├── App.vue
│   │   ├── main.js
│   │   ├── pages.json         # 路由配置
│   │   ├── manifest.json      # 应用配置
│   │   └── uni.scss
│   └── package.json
│
├── server/                    # Node.js 后端
│   ├── src/
│   │   ├── routes/            # 路由层
│   │   │   ├── auth.js
│   │   │   ├── posts.js
│   │   │   ├── friends.js
│   │   │   ├── messages.js
│   │   │   ├── notifications.js
│   │   │   ├── users.js
│   │   │   ├── admin.js
│   │   │   └── upload.js
│   │   ├── middleware/        # 中间件
│   │   │   ├── auth.js        # JWT 验证
│   │   │   ├── admin.js       # 管理员权限
│   │   │   └── validate.js    # 参数校验
│   │   ├── services/          # 业务逻辑层
│   │   │   ├── authService.js
│   │   │   ├── postService.js
│   │   │   ├── friendService.js
│   │   │   ├── chatService.js
│   │   │   └── notificationService.js
│   │   ├── socket/            # Socket.io 处理
│   │   │   └── chatHandler.js
│   │   ├── config/
│   │   │   └── supabase.js    # Supabase 客户端初始化
│   │   └── app.js             # Express 入口
│   ├── package.json
│   └── .env                   # 环境变量（Supabase URL/Key 等）
│
├── database/                  # 数据库脚本
│   └── schema.sql             # 建表 SQL（在 Supabase SQL Editor 中执行）
│
└── docs/                      # 文档
    └── architectures/         # → 指向当前 architectures/ 目录
```

---

## 12 天执行计划

### Phase 0：环境搭建（4月7日晚，3h）

```
目标：项目能跑起来，前后端联通
```

- [ ] 创建 Supabase 项目，获取 URL + anon key + service role key
- [ ] 在 Supabase SQL Editor 中执行建表 SQL（users, posts, friendships, likes, comments, messages, notifications, reports）
- [ ] 初始化 Node.js 后端项目（Express + Socket.io + @supabase/supabase-js）
- [ ] 初始化 uni-app 前端项目（HBuilderX 或 CLI）
- [ ] 后端写一个 `GET /api/health` 接口，前端调通
- [ ] Git 初始化，首次提交

**交付物**：前后端能互通的空壳项目

---

### Phase 1：认证系统（4月8日，5h）

```
目标：用户可以注册和登录
对应故事：US07 + US08
```

**后端：**
- [ ] `POST /api/auth/send-code` — 生成验证码（测试阶段固定返回 123456，存入内存/Redis）
- [ ] `POST /api/auth/register` — 验证码校验 → 创建用户 → 返回 JWT
- [ ] `POST /api/auth/login` — 手机号+密码 → 验证 → 返回 JWT
- [ ] `auth` 中间件 — 解析 JWT，注入 `req.user`

**前端：**
- [ ] 登录页 (`pages/login/`) — 手机号+密码输入，登录按钮
- [ ] 注册页 (`pages/register/`) — 手机号+验证码+密码，注册按钮
- [ ] Token 存储 — `uni.setStorageSync` 存 JWT
- [ ] 请求拦截器 — 自动在 Header 带上 `Authorization: Bearer <token>`
- [ ] 路由守卫 — 未登录跳转登录页

**验证**：能注册新用户 → 登录 → 进入首页空壳

---

### Phase 2：信息流 + 发帖（4月9-10日，8h）

```
目标：能发帖、能看到所有帖子
对应故事：US01 + US02
```

**后端：**
- [ ] `POST /api/posts` — 创建帖子（content, author_id）
- [ ] `GET /api/posts?page=1&limit=20` — 获取信息流（JOIN users 获取作者信息，按时间倒序，分页）
- [ ] 返回数据包含：帖子信息 + 作者昵称/头像 + 点赞数/评论数 + 当前用户是否已点赞 + 是否是好友

**前端：**
- [ ] 首页信息流 (`pages/index/`) — 帖子卡片列表
- [ ] `PostCard.vue` 组件 — 显示头像、昵称、内容、时间、点赞/评论数
- [ ] 下拉刷新 + 上拉加载更多
- [ ] 发帖页 (`pages/publish/`) — 文本输入框 + 发布按钮
- [ ] 底部 TabBar — 首页 / 消息 / 我的

**验证**：发一条帖子 → 返回首页能看到

---

### Phase 3：用户搜索 + 资料页 + 好友系统（4月11-12日，8h）

```
目标：能搜索用户、查看资料、加好友
对应故事：US10 + US11 + US03 + US04
```

**后端：**
- [ ] `GET /api/users/search?q=关键词` — 昵称模糊搜索
- [ ] `GET /api/users/:id` — 用户资料（含好友关系状态）
- [ ] `POST /api/friends/request` — 发送好友申请
- [ ] `GET /api/friends/requests` — 获取待处理的好友申请
- [ ] `PUT /api/friends/request/:id` — 接受/拒绝
- [ ] `GET /api/friends` — 好友列表

**前端：**
- [ ] 搜索页 (`pages/search/`) — 搜索框 + 用户列表
- [ ] 用户资料页 (`pages/user-profile/`) — 头像、昵称、学院、年级 + "添加好友"/"发消息"按钮
- [ ] 好友申请页 (`pages/friend-requests/`) — 申请列表 + 同意/拒绝按钮
- [ ] 好友列表页 (`pages/friends/`)
- [ ] PostCard 中点击头像 → 跳转用户资料页

**验证**：注册 2 个账号 → A 搜索 B → 查看资料 → 发送好友申请 → B 同意

---

### Phase 4：点赞 + 评论（4月13日，5h）

```
目标：好友之间可以互动
对应故事：US05 + US06
```

**后端：**
- [ ] `POST /api/posts/:id/like` — 点赞/取消点赞（toggle）
- [ ] 点赞前检查好友关系
- [ ] `GET /api/posts/:id/comments` — 获取评论列表（分页）
- [ ] `POST /api/posts/:id/comments` — 发表评论
- [ ] 评论前检查好友关系

**前端：**
- [ ] PostCard 点赞按钮 — 好友可点击，非好友置灰
- [ ] 帖子详情页 (`pages/post-detail/`) — 帖子内容 + 评论列表 + 评论输入框
- [ ] 非好友提示"添加好友后才能互动"

**验证**：A 和 B 是好友 → A 给 B 的帖子点赞/评论 → B 能看到

---

### Phase 5：私聊（4月14-15日，8h）

```
目标：好友之间可以实时聊天
对应故事：US09
```

**后端：**
- [ ] Socket.io 服务初始化（与 Express 共用 HTTP server）
- [ ] 用户上线时通过 JWT 认证并加入个人 room
- [ ] `chat:send` 事件 → 存入 messages 表 → 推送给接收者
- [ ] `GET /api/messages/:friendId?page=1` — 获取历史消息
- [ ] `GET /api/messages/conversations` — 获取聊天列表（最近的会话）

**前端：**
- [ ] 聊天列表页 (`pages/chat-list/`) — 最近聊天的好友列表 + 最后一条消息预览
- [ ] 聊天页 (`pages/chat/`) — 消息气泡列表 + 输入框 + 发送按钮
- [ ] Socket.io 客户端连接，监听实时消息
- [ ] 新消息来时聊天列表更新

**验证**：A 和 B 互为好友 → A 发消息 → B 实时收到

---

### Phase 6：收尾 + Lab2 报告 + PPT（4月16-19日，4天）

```
目标：完成所有交付物
```

**4月16日 — 个人中心 + 管理功能（轻量版）：**
- [ ] 个人中心页 (`pages/mine/`) — 头像、昵称、编辑资料入口、好友列表入口
- [ ] 编辑资料页 — 修改昵称、头像、学院、年级
- [ ] 管理员页面（简单版）— 用户列表 + 封禁/解封按钮

**4月17日 — MockPlus 原型 + CodeArts：**
- [ ] 在 MockPlus 中设计 5 个高优先级用户故事的 UI 原型
  1. 信息流浏览
  2. 发布帖子
  3. 帖子互动（点赞/评论）
  4. 实时私聊
  5. 好友系统（申请/处理）
- [ ] 在 CodeArts 中建立 Scrum 项目
  - 添加团队成员
  - 录入 Product Backlog（21 个 User Story）
  - 创建 2 个 Sprint，分配故事
  - 截图 Story Board 和 Burndown Chart

**4月18日 — 写 Lab2 实验报告：**
- [ ] 将 architectures/ 中的内容整理进 doc 模板
- [ ] 补充实验要求复述
- [ ] 插入 MockPlus 原型截图
- [ ] 插入 CodeArts 截图
- [ ] 写大模型辅助部分（记录和 Claude 的对话作为提示词）
- [ ] 写计划与实际进度对比表
- [ ] 写小结

**4月19日 — PPT + 演示视频：**
- [ ] 按 PPT 模板填写所有 slide
- [ ] 插入系统真实运行截图
- [ ] 录制 ≤5 分钟演示视频（注册→发帖→加好友→互动→私聊）
- [ ] 提交到学习通

---

## 技术细节备忘

### Supabase 免费套餐限制
- 数据库：500MB
- Storage：1GB
- 带宽：2GB/月
- 实时连接：200 并发
- **对 100 人测试完全够用**

### uni-app 开发注意
- 使用 `uni.request` 替代 axios（跨平台兼容）
- 或者封装一层，H5 用 axios，小程序/App 用 uni.request
- Socket.io 在小程序端需要用 `weapp.socket.io` 适配包
- 页面路由用 `pages.json` 配置，不用 vue-router

### 测试阶段短信验证码
- 后端写死：任何手机号发送验证码都返回成功，验证码固定 `123456`
- 上线前替换为真实短信 API（阿里云/腾讯云短信，约 0.05 元/条）

### 部署方案（VPS 2C4G）
```
Nginx (80/443)
  ├── / → 静态文件（uni-app H5 build）
  ├── /api → proxy_pass → Node:3000
  └── /socket.io → proxy_pass (WebSocket) → Node:3000

PM2 管理 Node 进程
Let's Encrypt 免费 SSL 证书
```

---

## 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| 私聊（Phase 5）耗时超预期 | 中 | 高 | 如果到 4/14 还没做完，先用轮询代替 WebSocket |
| uni-app 多端兼容问题 | 中 | 中 | 先只保证 H5 端可用，App/小程序延后 |
| Supabase 免费套餐限制 | 低 | 低 | 100 人测试远在限制内 |
| 4/19 前功能不完整 | 中 | 高 | PPT 展示已完成的部分，未完成的用 MockPlus 原型代替 |
