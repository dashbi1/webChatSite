// 每 30 分钟更新 fingerprints.account_count 和 ip_records.account_count
// 作用：DEVICE_MULTI_ACCOUNT 规则查询时可以用 fingerprints.account_count 快速过滤候选（非必须）
// 另外聚类检测也依赖这些字段
//
// 实现：用 SQL 聚合一次更新所有行（比 Node 端 loop 快数量级）

const supabase = require('../config/supabase');

// 通过 RPC 执行批量更新（如果 DBA 建了）；否则走 Node fallback
async function updateFingerprintCounts() {
  // 方案 A：RPC 函数 update_fingerprint_account_counts()（推荐，后续可在迁移里建）
  // 方案 B：分批 upsert（当前实现）
  try {
    // 取所有有关联的指纹 + 它们的真实 count
    const { data: rows, error } = await supabase
      .from('user_fingerprints')
      .select('fingerprint_id', { count: 'exact' });
    if (error) {
      console.warn('[cron:updateAccountCounts] fp select error:', error.message);
      return;
    }
    // 纯 Node 聚合
    const counts = new Map();
    for (const r of rows || []) {
      counts.set(r.fingerprint_id, (counts.get(r.fingerprint_id) || 0) + 1);
    }
    // 分批更新（每 100 条一批）
    const entries = Array.from(counts.entries());
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      await Promise.all(
        batch.map(([id, count]) =>
          supabase.from('fingerprints').update({ account_count: count }).eq('id', id)
        )
      );
    }
    console.log(`[cron:updateAccountCounts] updated ${entries.length} fingerprints`);
  } catch (err) {
    console.warn('[cron:updateAccountCounts] fp error:', err && err.message);
  }
}

async function updateIpCounts() {
  try {
    const { data: rows, error } = await supabase.from('user_ips').select('ip_id');
    if (error) {
      console.warn('[cron:updateAccountCounts] ip select error:', error.message);
      return;
    }
    const counts = new Map();
    for (const r of rows || []) {
      counts.set(r.ip_id, (counts.get(r.ip_id) || 0) + 1);
    }
    const entries = Array.from(counts.entries());
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      await Promise.all(
        batch.map(([id, count]) =>
          supabase.from('ip_records').update({ account_count: count }).eq('id', id)
        )
      );
    }
    console.log(`[cron:updateAccountCounts] updated ${entries.length} ip_records`);
  } catch (err) {
    console.warn('[cron:updateAccountCounts] ip error:', err && err.message);
  }
}

async function updateAccountCounts() {
  await updateFingerprintCounts();
  await updateIpCounts();
}

module.exports = { updateAccountCounts, updateFingerprintCounts, updateIpCounts };
