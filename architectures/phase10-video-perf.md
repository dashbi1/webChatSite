# Phase 10：视频帖 + 性能优化

## 实现状态：待开发

## 对应用户故事
- US21 - 发布视频帖子
- 性能优化（迭代1 反馈 F01）

## 一、US21 视频帖

### 规则
- 支持 MP4 格式，最大 20MB
- 每条帖子可以同时有图片和视频（media_urls 混合）
- media_type 新增 'video' 和 'mixed' 类型
- 发帖时可选择图片和/或视频

### API 变更

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/api/upload/post-video` | 新增，上传视频到 Supabase Storage |
| POST | `/api/posts` | media_type 支持 'video' 和 'mixed' |

### Supabase Storage
- bucket: `post-videos`（公开读）
- 文件命名：`{userId}/{timestamp}_{random}.mp4`
- 大小限制：20MB

### 前端改动
- **发帖页**：新增"选视频"按钮，`uni.chooseVideo` 选择 + 上传
- **PostCard**：检测视频 URL（.mp4），用 `<video>` 标签展示（带播放按钮）
- **帖子详情页**：视频全屏播放

### media_type 逻辑
- 只有图片 → `image`
- 只有视频 → `video`
- 图片+视频都有 → `mixed`
- 都没有 → `none`

## 二、性能优化

### 2.1 前端缓存（stale-while-revalidate）
- 信息流、好友列表、会话列表缓存到 `uni.setStorageSync`
- 进入页面时：
  1. 立刻展示缓存数据（瞬间显示）
  2. 后台请求最新数据
  3. 新数据到达后替换缓存并更新 UI
- 缓存 key 格式：`cache_posts_latest`、`cache_friends`、`cache_conversations`

### 2.2 骨架屏
- 信息流加载时显示骨架屏（灰色占位块模拟帖子卡片）
- 替代"加载中..."文字，体验更好

### 2.3 图片懒加载
- PostCard 中的图片使用 `lazy-load` 属性
- 视口外的图片不加载，滚动到可见时才加载

### 2.4 减少重复请求
- onShow 时检查上次加载时间，3 秒内不重复请求
- 避免快速切 Tab 导致多次请求

## 关键文件

### 新建
- `client/src/components/SkeletonPost.vue` — 骨架屏组件

### 修改
- `server/src/routes/upload.js` — 新增视频上传端点
- `server/src/routes/posts.js` — media_type 逻辑更新
- `client/src/pages/publish/index.vue` — 视频选择 + 上传
- `client/src/components/PostCard.vue` — 视频播放器 + 图片懒加载
- `client/src/pages/index/index.vue` — 骨架屏 + 缓存
- `client/src/pages/friends/index.vue` — 缓存
- `client/src/pages/chat-list/index.vue` — 缓存

## 测试计划
- 视频上传（MP4, <20MB）
- 超大视频拒绝（>20MB）
- 视频帖在信息流中展示
- 同时有图片+视频的帖子正确展示
- sort=hot 和 sort=latest 都能返回视频帖
- 缓存命中时页面秒开
