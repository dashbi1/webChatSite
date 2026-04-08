# Phase 3: 用户搜索 + 好友系统

## 实现状态：已完成

## 对应用户故事
- US03 - 发送好友申请
- US04 - 处理好友申请
- US10 - 搜索用户
- US11 - 查看用户资料

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/search?q=` | 搜索用户（昵称模糊匹配，排除自己） |
| GET | `/api/users/:id` | 查看用户资料（含好友关系状态） |
| GET | `/api/users/me` | 获取当前用户信息 |
| PUT | `/api/users/me` | 更新个人资料 |
| POST | `/api/friends/request` | 发送好友申请 |
| GET | `/api/friends/requests` | 收到的好友申请列表 |
| PUT | `/api/friends/request/:id` | 处理申请（accept/reject） |
| GET | `/api/friends` | 好友列表 |
| DELETE | `/api/friends/:id` | 删除好友 |

## 技术实现
- **好友关系**：双向确认（requester → addressee，pending → accepted/rejected）
- **防重复**：UNIQUE(requester_id, addressee_id) + 双向检查
- **用户资料页**：返回 friend_status（none/pending/accepted）+ 发帖数
- **搜索**：PostgreSQL ilike 模糊匹配，排除自己和封禁用户

## 关键文件
- `server/src/routes/friends.js` — 好友路由
- `server/src/routes/users.js` — 用户路由

## 测试覆盖（12 用例）
- 好友申请：发送成功、重复发送、添加自己
- 申请列表：接收方可见、发起方不可见
- 处理申请：接受、无效操作
- 好友列表：双方互为好友
- 搜索：匹配用户、空关键词
- 资料页：好友状态、陌生人状态
