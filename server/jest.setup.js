// Jest 全局 setup：加载 .env（业务模块顶层 import supabase 依赖这些）
require('dotenv').config();

// 单元测试默认关闭 Turnstile 和 RATE_LIMIT（避免需要真实密钥）
// 具体测试需要开关时在 beforeEach 里覆盖
if (!process.env.TURNSTILE_ENABLED) process.env.TURNSTILE_ENABLED = 'false';
if (!process.env.RATE_LIMIT_ENABLED) process.env.RATE_LIMIT_ENABLED = 'false';
