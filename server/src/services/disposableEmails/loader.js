// 一次性邮箱黑名单：启动时加载 disposable_email_domains 表到内存 Set，O(1) 查询。
// cron 更新后调用 reload() 刷新。

const supabase = require('../../config/supabase');

let cache = new Set();
let loadedAt = 0;

async function loadFromDb() {
  try {
    const { data, error } = await supabase
      .from('disposable_email_domains')
      .select('domain');
    if (error) {
      console.warn('[disposable] load warning:', error.message);
      return;
    }
    const set = new Set();
    for (const row of data || []) {
      if (row && row.domain) set.add(row.domain.toLowerCase());
    }
    cache = set;
    loadedAt = Date.now();
    console.log(`[disposable] loaded ${cache.size} domains`);
  } catch (err) {
    console.warn('[disposable] load error:', err && err.message);
  }
}

function isDisposable(email) {
  if (typeof email !== 'string') return false;
  const at = email.indexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return cache.has(domain);
}

function getLoadedSize() {
  return cache.size;
}

function getLoadedAt() {
  return loadedAt;
}

// 测试用：直接注入一组域名
function _setForTests(domains) {
  cache = new Set(domains.map((d) => d.toLowerCase()));
  loadedAt = Date.now();
}

module.exports = {
  loadFromDb,
  reload: loadFromDb,
  isDisposable,
  getLoadedSize,
  getLoadedAt,
  _setForTests,
};
