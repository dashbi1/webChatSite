# Phase 1: 认证系统

## 实现状态：已完成

## 对应用户故事
- US07 - 手机号注册
- US08 - 登录

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/send-code` | 发送验证码（测试阶段固定 123456） |
| POST | `/api/auth/register` | 注册（手机号+验证码+密码+昵称） |
| POST | `/api/auth/login` | 登录（手机号+密码，返回 JWT） |

## 技术实现
- **密码加密**：bcryptjs，10 轮 salt
- **JWT**：jsonwebtoken，7 天过期，payload 含 id/phone/role
- **验证码**：内存 Map 存储，5 分钟过期，测试阶段固定 123456
- **中间件**：`authMiddleware` 解析 JWT 注入 `req.user`，`adminMiddleware` 检查 role

## 关键文件
- `server/src/routes/auth.js` — 认证路由
- `server/src/middleware/auth.js` — JWT + 管理员中间件

## 测试覆盖（13 用例）
- 发送验证码：合法手机号、非法手机号、空手机号
- 注册：正常注册、错误验证码、缺少字段、重复注册
- 登录：正确密码、错误密码、不存在的手机号
- 中间件：无 token、无效 token、有效 token

## 已知限制
- 验证码存在内存中，服务重启后丢失
- 未接入真实短信 API（上线前替换）
