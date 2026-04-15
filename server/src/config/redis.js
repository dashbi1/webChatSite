// Upstash Redis 客户端封装
// 提供一个懒初始化的单例；没有配置 URL/TOKEN 时返回 noop 实现，方便本地/测试跳过 Redis。

const { Redis } = require('@upstash/redis');

let instance = null;
let isNoop = false;

function createNoop() {
  // 测试/未配置场景的 Redis 空实现。incr 永远返回 1（第一次），不限流。
  return {
    isNoop: true,
    async incr() { return 1; },
    async expire() { return 1; },
    async get() { return null; },
    async set() { return 'OK'; },
    async del() { return 0; },
    async ttl() { return -1; },
  };
}

function getRedis() {
  if (instance) return instance;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || url.startsWith('https://tokyo-xxx')) {
    // 占位值也视作未配置
    isNoop = true;
    instance = createNoop();
    return instance;
  }
  instance = new Redis({ url, token });
  return instance;
}

function isRedisNoop() {
  getRedis();
  return isNoop;
}

// 仅测试用：重置单例（让测试能切换 env）
function _resetForTests() {
  instance = null;
  isNoop = false;
}

module.exports = { getRedis, isRedisNoop, _resetForTests };
