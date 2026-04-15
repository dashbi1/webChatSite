// 从 GitHub 拉取最新一次性邮箱域名列表并 upsert 到 disposable_email_domains 表。
// 数据源：github.com/disposable-email-domains/disposable-email-domains

const supabase = require('../../config/supabase');
const { reload } = require('./loader');

const SOURCE_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf';
const SOURCE_ID = 'github:disposable-email-domains/v1';

async function fetchList(url = SOURCE_URL, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    return text
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'));
  } finally {
    clearTimeout(timer);
  }
}

async function updateDisposableDomains(options = {}) {
  const fetcher = options.fetcher || fetchList;
  const batchSize = options.batchSize || 500;
  const started = Date.now();
  const domains = await fetcher();
  if (!Array.isArray(domains) || domains.length === 0) {
    return { updated: 0, skipped: true, reason: 'empty source' };
  }
  const rows = domains.map((d) => ({ domain: d, source: SOURCE_ID }));
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('disposable_email_domains')
      .upsert(slice, { onConflict: 'domain' });
    if (error) {
      console.error('[disposable:update] batch error:', error.message);
      throw new Error(`upsert batch failed: ${error.message}`);
    }
    written += slice.length;
  }
  await reload();
  const elapsed = Date.now() - started;
  console.log(
    `[disposable:update] updated ${written} domains in ${elapsed}ms`
  );
  return { updated: written, elapsed };
}

module.exports = {
  updateDisposableDomains,
  fetchList,
  SOURCE_URL,
  SOURCE_ID,
};
