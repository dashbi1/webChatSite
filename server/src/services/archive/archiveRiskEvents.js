// Phase 4：归档 90 天前 risk_events（每周日 04:00 cron 调）
//
// 流程：
//   1. 批量读 risk_events WHERE created_at < cutoff LIMIT batchSize
//   2. 插入到 risk_events_archive（字段一致 + archived_at）
//   3. 从 risk_events 删除对应 id
//   4. 循环直到某批返回 <batchSize
//
// 失败时立刻中断返回，保证不会"归档了但未删除"或"删除了但归档未成功"错位太远。
// risk_score_decay_log 不归档（保持完整）。

const supabase = require('../../config/supabase');

async function runArchive(daysOld = 90, batchSize = 500) {
  const cutoff = new Date(Date.now() - daysOld * 86400 * 1000).toISOString();
  const summary = {
    cutoff,
    copied: 0,
    deleted: 0,
    batches: 0,
    errors: 0,
  };

  while (true) {
    const { data: batch, error: readErr } = await supabase
      .from('risk_events')
      .select('id, user_id, rule_code, score_delta, reason, evidence, mode, created_at')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (readErr) {
      console.warn('[archive] read failed:', readErr.message);
      summary.errors++;
      break;
    }
    if (!batch || batch.length === 0) break;

    const archiveRows = batch.map(r => ({
      id: r.id,
      user_id: r.user_id,
      rule_code: r.rule_code,
      score_delta: r.score_delta,
      reason: r.reason,
      evidence: r.evidence,
      mode: r.mode,
      created_at: r.created_at,
      archived_at: new Date().toISOString(),
    }));

    const { error: insErr } = await supabase
      .from('risk_events_archive')
      .insert(archiveRows);
    if (insErr) {
      console.warn('[archive] insert failed:', insErr.message);
      summary.errors++;
      break;
    }
    summary.copied += archiveRows.length;

    const ids = batch.map(b => b.id);
    const { error: delErr } = await supabase
      .from('risk_events')
      .delete()
      .in('id', ids);
    if (delErr) {
      console.warn('[archive] delete failed:', delErr.message);
      summary.errors++;
      break;
    }
    summary.deleted += ids.length;
    summary.batches++;

    if (batch.length < batchSize) break;
  }

  return summary;
}

module.exports = { runArchive };
