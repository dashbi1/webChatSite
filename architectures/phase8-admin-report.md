# Phase 8：管理员后台 + 举报

## 实现状态：待开发

## 对应用户故事
- US19 - 管理员封禁用户
- US20 - 管理员删除帖子
- US17 - 举报帖子/用户

## 一、管理员后台

### 访问方式
- 独立网页，由 Express 后端 serve 静态 HTML
- URL 路径从配置文件读取（如 `.env` 中 `ADMIN_PATH=console-a7x9k3`）
- 访问 `http://localhost:3000/{ADMIN_PATH}` 进入管理后台
- 需要管理员账号登录后才能操作 API

### 技术方案
- 纯 HTML + Vue 3 CDN（单文件，不需要构建工具）
- Express `app.use('/{ADMIN_PATH}', express.static('admin'))` serve 静态文件
- 调用现有的 `/api/admin/*` 后端 API

### 后台页面功能

#### 用户管理
- 用户列表（分页，按注册时间倒序）
- 搜索（手机号/昵称）
- 操作：封禁 / 解封
- 显示：头像、昵称、手机号、学院、状态、注册时间

#### 帖子管理
- 帖子列表（分页，按时间倒序）
- 搜索（内容关键词）
- 操作：删除
- 显示：作者、内容摘要、图片数、点赞数、评论数、发布时间

#### 举报处理
- 举报列表（未处理优先，分页）
- 操作：处理（删帖+封禁）/ 驳回
- 显示：举报者、被举报目标（帖子/用户）、举报原因、时间、状态

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users?page=&q=` | 用户列表（搜索） |
| PUT | `/api/admin/users/:id/ban` | 封禁用户 |
| PUT | `/api/admin/users/:id/unban` | 解封用户 |
| GET | `/api/admin/posts?page=&q=` | 帖子列表（搜索） |
| DELETE | `/api/admin/posts/:id` | 管理员删帖 |
| GET | `/api/admin/reports?page=&status=` | 举报列表 |
| PUT | `/api/admin/reports/:id` | 处理举报（action: resolve/dismiss） |

所有 `/api/admin/*` 路由需要 `adminMiddleware`（检查 role=admin）。

## 二、用户举报

### 举报入口
- **帖子卡片**（PostCard）：他人帖子的 `···` 菜单显示"举报"选项
- **用户资料页**（user-profile）：非好友/非自己时显示"举报"按钮

### 举报流程
1. 点击举报 → 弹出原因选择（内容违规/垃圾广告/人身攻击/其他）
2. 可选填写补充说明
3. 提交 → 后端存入 reports 表
4. 管理员在后台查看并处理

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/reports` | 提交举报（target_type, target_id, reason） |

### 数据库
- reports 表已存在（id, reporter_id, target_type, target_id, reason, status, created_at）
- target_type: 'post' 或 'user'
- status: 'pending' → 'resolved' 或 'dismissed'

## 三、管理员账号

- 在 `.env` 中配置 `ADMIN_PHONE=13800000001`
- 服务启动时检查该手机号用户是否存在且 role=admin，不是则自动更新
- 或手动通过 Supabase SQL 设置

## 关键文件

### 新建
- `server/admin/index.html` — 管理后台页面
- `server/src/routes/reports.js` — 举报路由

### 修改
- `server/.env` — 添加 ADMIN_PATH 配置
- `server/src/app.js` — serve 管理后台静态文件 + 注册 reports 路由
- `server/src/routes/admin.js` — 完善管理员 API
- `client/src/components/PostCard.vue` — 他人帖子加举报选项
- `client/src/pages/user-profile/index.vue` — 加举报按钮

## 测试计划
- 管理员登录 → 获取用户列表
- 封禁用户 → 该用户无法登录
- 解封用户 → 恢复登录
- 管理员删帖
- 非管理员调用管理 API → 403
- 用户提交举报（帖子/用户）
- 管理员处理举报（resolve/dismiss）
- 举报列表按状态筛选
