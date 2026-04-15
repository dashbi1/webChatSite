// system_config 表读取封装：带 10s 内存缓存避免频繁打 Supabase
const supabase = require('../../config/supabase');

const CACHE_TTL_MS = 10 * 1000; // 所有 config 10s 缓存
let cache = new Map(); // key -> { value, expiresAt }

async function getSystemConfig(key, defaultValue = undefined) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.warn(`[systemConfig] read error: ${key}`, error.message);
      return defaultValue;
    }
    const value = data ? data.value : defaultValue;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.warn(`[systemConfig] read exception: ${key}`, err && err.message);
    return defaultValue;
  }
}

async function setSystemConfig(key, value, operatorId = null) {
  const { error } = await supabase
    .from('system_config')
    .upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by: operatorId },
      { onConflict: 'key' }
    );
  if (error) throw new Error(`setSystemConfig failed: ${error.message}`);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function _clearCache() { cache.clear(); }

module.exports = { getSystemConfig, setSystemConfig, _clearCache };
