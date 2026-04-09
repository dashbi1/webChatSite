# Phase 11：基础补全

## 实现状态：待开发

## 对应用户故事
- US24 - 修改密码
- US25 - 聊天消息时间标签
- US23 - 给被封禁用户发消息时前端弹出提示

## 一、US24 修改密码

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/auth/change-password` | 修改密码（需登录） |

### 请求参数
```json
{
  "oldPassword": "旧密码",
  "newPassword": "新密码"
}
```

### 后端逻辑
1. 从 `req.user.id` 查用户
2. bcrypt 验证旧密码
3. 新密码 >= 6 位
4. bcrypt 加密新密码，更新数据库
5. 返回成功，前端清除 token 跳转登录页

### 前端
- "我的" 页面菜单新增 "修改密码" 入口
- 新建 `pages/change-password/index.vue`
- 表单：旧密码 + 新密码 + 确认新密码
- 修改成功后自动退出登录

## 二、US25 聊天消息时间标签

### 逻辑
- 遍历消息列表，判断相邻消息时间间隔
- 间隔 > 5 分钟时，在两条消息之间插入时间分隔线
- 第一条消息前也显示时间

### 时间格式
| 条件 | 格式 | 示例 |
|------|------|------|
| 今天 | HH:mm | 14:30 |
| 昨天 | 昨天 HH:mm | 昨天 09:15 |
| 更早 | MM/DD HH:mm | 04/08 16:22 |

### 前端改动
- `pages/chat/index.vue`：在渲染消息前计算时间分隔
- 用 computed 或 render 函数在消息列表中插入时间节点

## 三、US23 封禁用户发消息提示

### 现状
- 后端 chatHandler 已拦截给被封禁用户发消息（emit `chat:error`）
- 前端未监听 `chat:error`

### 前端改动
- `pages/chat/index.vue`：监听 `chat:error` 事件
- 收到错误时 `uni.showToast` 显示错误内容

## 关键文件

### 新建
- `client/src/pages/change-password/index.vue` — 修改密码页

### 修改
- `server/src/routes/auth.js` — 新增 change-password API
- `client/src/pages/mine/index.vue` — 新增修改密码入口
- `client/src/pages/chat/index.vue` — 时间标签 + chat:error 监听
- `client/src/pages.json` — 注册修改密码页路由

## 测试计划
- 修改密码：正确旧密码 → 成功
- 修改密码：错误旧密码 → 400
- 修改密码：新密码太短 → 400
- 修改后旧密码无法登录
- 修改后新密码可以登录
- 聊天时间标签正确显示（间隔判断）
- 给被封禁用户发消息 → Toast 提示
