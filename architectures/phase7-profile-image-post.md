# Phase 7：资料编辑 + 图片帖 + 帖子管理

## 实现状态：待开发

## 对应用户故事
- US16 - 编辑个人资料
- US15 - 发布图片帖子
- US18 - 删除/编辑帖子（前端补全）

## 一、US16 编辑个人资料

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/users/me` | 更新昵称/学院/年级（已有） |
| POST | `/api/users/me/avatar` | 上传头像（新增） |

### 头像上传流程
1. 前端 `uni.chooseImage` 选择图片
2. 压缩后上传到 Supabase Storage `avatars` bucket
3. 获取公开 URL，写入 users.avatar_url
4. 旧头像文件从 Storage 删除

### 前端页面
- **资料编辑页** (`pages/edit-profile/index.vue`)
  - 头像（点击更换）
  - 昵称输入框
  - 学院选择/输入
  - 年级选择/输入
  - 保存按钮

## 二、US15 图片帖子

### API 变更

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/api/posts` | 新增 media_urls 参数（图片 URL 数组） |
| POST | `/api/upload/images` | 批量上传图片到 Supabase Storage（新增） |

### 图片上传流程
1. 前端选择图片（最多 9 张）
2. 逐张上传到 Supabase Storage `post-images` bucket
3. 收集返回的公开 URL 数组
4. 发帖时 media_urls = URL 数组，media_type = 'image'

### 前端改动
- **发帖页**：添加图片选择区域（九宫格预览 + 添加按钮）
- **PostCard 组件**：展示图片（单图大图、多图九宫格）
- **图片预览**：点击图片全屏预览

### Supabase Storage 配置
- bucket: `post-images`（公开读）
- bucket: `avatars`（公开读）
- 文件命名：`{userId}/{timestamp}_{random}.jpg`
- 大小限制：单张 5MB

## 三、US18 帖子编辑/删除（前端补全）

### 现状
- 后端 PUT/DELETE `/api/posts/:id` 已实现且测试通过
- 前端 PostCard 没有编辑/删除入口

### 前端改动
- PostCard 右上角增加 `···` 操作按钮（仅自己的帖子可见）
- 点击弹出 ActionSheet：编辑 / 删除
- 编辑：跳转发帖页（预填内容，编辑模式）
- 删除：二次确认弹窗 → 调用 DELETE API → 刷新列表

## 关键文件（待创建/修改）

### 新建
- `server/src/routes/upload.js` — 文件上传路由
- `client/src/pages/edit-profile/index.vue` — 资料编辑页

### 修改
- `server/src/app.js` — 注册 upload 路由
- `server/src/routes/users.js` — 头像上传端点
- `client/src/components/PostCard.vue` — 图片展示 + 操作菜单
- `client/src/pages/publish/index.vue` — 图片选择上传
- `client/src/pages.json` — 新增资料编辑页路由
- `client/src/api/post.js` — 图片上传 API
- `client/src/api/user.js` — 头像上传 API

## 测试计划
- 头像上传 + 更新资料
- 图片帖发布（1张、多张、超过9张拒绝）
- 图片帖在信息流中正确展示
- 自己的帖子显示操作菜单
- 他人帖子不显示操作菜单
- 编辑帖子（内容更新 + is_edited 标记）
- 删除帖子
