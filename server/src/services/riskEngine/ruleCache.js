// 规则配置缓存：启动时空，首次调用 getRules() 从 DB 加载；
// TTL 由 system_config.rules_cache_ttl_seconds 控制（默认 600s）
// 管理员修改规则后调用 invalidate() 立即失效

const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');

let cache = null;     // Array of rule rows
let loadedAt = 0;

async function getRules() {
  const ttlSec = (await getSystemConfig('rules_cache_ttl_seconds', 600)) || 600;
  const ttlMs = Number(ttlSec) * 1000;
  if (cache && Date.now() - loadedAt < ttlMs) return cache;

  const { data, error } = await supabase
    .from('risk_rules')
    .select('*');
  if (error) {
    console.warn('[ruleCache] load error:', error.message);
    return cache || []; // 退化：用旧缓存或空数组
  }
  cache = data || [];
  loadedAt = Date.now();
  return cache;
}

async function getRule(code) {
  const rules = await getRules();
  return rules.find((r) => r.code === code) || null;
}

function invalidate() {
  cache = null;
  loadedAt = 0;
}

// 测试注入：直接塞规则数组，不走 DB
function _setForTests(rules) {
  cache = rules;
  loadedAt = Date.now();
}

module.exports = { getRules, getRule, invalidate, _setForTests };
