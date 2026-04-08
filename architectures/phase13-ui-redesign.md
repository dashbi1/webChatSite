# Phase 13：前端 UI 全面升级

## 实现状态：待开发

## 对应用户故事
- US28 - 前端 UI 全面升级（清爽简约风格）

## 设计原则
- **清爽简约**：大量留白，层次分明，不花哨
- **主色调**：#4A90D9（蓝色），辅以 #f7f8fa（浅灰背景）、#fff（白色卡片）
- **统一规范**：间距、圆角、字号、颜色形成体系
- **管理后台不改**

## 设计规范

### 颜色体系
| 用途 | 色值 |
|------|------|
| 主色 | #4A90D9 |
| 主色浅 | #EBF3FC |
| 成功 | #27ae60 |
| 危险/错误 | #e74c3c |
| 警告 | #f39c12 |
| 正文 | #333333 |
| 次要文字 | #999999 |
| 占位/禁用 | #cccccc |
| 分割线 | #f0f0f0 |
| 页面背景 | #f7f8fa |
| 卡片背景 | #ffffff |

### 字号体系
| 层级 | 大小 | 用途 |
|------|------|------|
| H1 | 36rpx | 页面标题 |
| H2 | 32rpx | 卡片标题、昵称 |
| Body | 28rpx | 正文内容 |
| Caption | 24rpx | 时间、辅助信息 |
| Small | 22rpx | 标签、角标 |

### 间距体系
| 级别 | 大小 | 用途 |
|------|------|------|
| xs | 8rpx | 紧凑间距 |
| sm | 16rpx | 元素间 |
| md | 24rpx | 卡片内边距 |
| lg | 32rpx | 区块间 |
| xl | 48rpx | 页面边距 |

### 圆角
| 元素 | 圆角 |
|------|------|
| 按钮 | 16rpx |
| 卡片 | 16rpx |
| 头像 | 50%（圆形） |
| 输入框 | 12rpx |
| 标签/badge | 20rpx |

## 改版页面清单

### 1. 登录页 (`pages/login/index.vue`)
- 顶部 Logo + 标题居中
- 输入框圆角、带图标前缀（手机/锁）
- 主色按钮，圆角，轻阴影
- "立即注册"链接文字

### 2. 注册页 (`pages/register/index.vue`)
- 与登录页风格统一
- 步骤感：手机号 → 验证码 → 密码
- 验证码按钮倒计时样式

### 3. 首页信息流 (`pages/index/index.vue`)
- 顶部导航栏：标题左对齐，搜索+铃铛右对齐
- Tab 切换（最新/热门）：下划线指示器
- 帖子卡片：白色卡片 + 16rpx 圆角 + 轻阴影
- 头像圆形，昵称加粗，时间淡化
- 图片九宫格间距统一
- 底部操作栏：图标 + 数字，间距均匀

### 4. 帖子详情页 (`pages/post-detail/index.vue`)
- 帖子内容区与评论区分开
- 评论项：头像 + 昵称 + 内容 + 时间
- 底部输入栏固定

### 5. 聊天页 (`pages/chat/index.vue`)
- 消息气泡：自己蓝色圆角，对方白色圆角
- 头像靠边，气泡圆角更大
- 输入栏：圆角输入框 + 蓝色发送按钮

### 6. 个人中心 (`pages/mine/index.vue`)
- 顶部个人卡片：大头像 + 昵称 + 学院
- 菜单列表：图标 + 文字 + 箭头，白色卡片分组
- 退出按钮底部，红色文字

### 7. 发帖页 (`pages/publish/index.vue`)
- 大文本框，无边框，focus 下划线
- 图片/视频选择区更美观
- 发布按钮右上角或底部固定

### 8. 搜索页 (`pages/search/index.vue`)
- 顶部搜索栏：圆角输入框 + 取消按钮
- 搜索结果列表卡片化

### 9. 组件统一
- **PostCard**：统一卡片样式
- **NotificationBell**：铃铛图标统一大小
- **NotificationPanel**：面板圆角 + 阴影
- **FriendPicker**：底部弹出，圆角顶部

## 不改的页面
- 管理后台 (`server/admin/index.html`)

## 测试策略
- 改版后运行全量已有测试（109 用例），确保功能不被破坏
- UI 改版不新增测试用例（纯样式改动）
- 手动浏览器联调验证所有页面视觉效果

## 关键文件（全部修改）
- `client/src/pages/login/index.vue`
- `client/src/pages/register/index.vue`
- `client/src/pages/index/index.vue`
- `client/src/pages/post-detail/index.vue`
- `client/src/pages/chat/index.vue`
- `client/src/pages/mine/index.vue`
- `client/src/pages/publish/index.vue`
- `client/src/pages/search/index.vue`
- `client/src/pages/friends/index.vue`
- `client/src/pages/friend-requests/index.vue`
- `client/src/pages/user-profile/index.vue`
- `client/src/pages/edit-profile/index.vue`
- `client/src/pages/chat-list/index.vue`
- `client/src/components/PostCard.vue`
- `client/src/components/NotificationBell.vue`
- `client/src/components/NotificationPanel.vue`
- `client/src/components/FriendPicker.vue`
- `client/src/components/ShareCard.vue`
- `client/src/components/SkeletonPost.vue`
