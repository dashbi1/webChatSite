# Phase 4: 点赞 + 评论

## 实现状态：已完成

## 对应用户故事
- US05 - 好友点赞帖子
- US06 - 好友评论帖子

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/posts/:id/like` | 点赞/取消点赞（toggle） |
| GET | `/api/posts/:id/comments` | 获取评论列表（分页，时间正序） |
| POST | `/api/posts/:id/comments` | 发表评论 |

## 技术实现
- **好友检查**：点赞和评论前检查好友关系，非好友返回 403（自己的帖子除外）
- **点赞 toggle**：已点赞则取消，未点赞则添加
- **计数维护**：通过 Supabase RPC 函数 `increment_like_count` / `decrement_like_count` / `increment_comment_count` 原子更新
- **信息流集成**：GET /api/posts 返回 `is_liked`（当前用户是否点赞）和 `is_friend`（是否好友）

## 关键文件
- `server/src/routes/posts.js` — 点赞/评论路由（与帖子路由同文件）
- `database/functions.sql` — 计数 RPC 函数

## 测试覆盖（11 用例）
- 点赞：好友点赞成功、再次取消、陌生人 403、自己可点赞
- 评论：好友评论成功、陌生人 403、空评论、自己可评论
- 评论列表：时间正序、包含用户信息
- 信息流状态：好友 is_friend=true + is_liked 正确、陌生人 is_friend=false
