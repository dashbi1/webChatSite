// Phase 4：孤岛簇检测（每小时 cron 调）
// 判定：
//   - 所有成员 < new_days 天注册
//   - 簇内互动率 > internal_rate_threshold（默认 0.6）
//   - 任一成员对外互动数 < external_max_per_user（默认 3）
//   - cluster_size >= min_cluster_size（默认 3）
// 命中后：
//   - 写 account_clusters(cluster_type='isolated_island', status='pending')
//   - 对每个成员触发 ISOLATED_ISLAND 规则加分（走 dedup/decay，24h once）

const supabase = require('../../config/supabase');
const { getRules } = require('../riskEngine/ruleCache');
const { computeAppliedDelta } = require('../riskEngine/dedupDecay');
const { recordEvent } = require('../riskEngine/scoreStore');
const {
  collectInteractionEdges,
  buildAdjacency,
  findConnectedComponents,
  computeClusterStats,
} = require('./interactionGraph');

async function detect() {
  const rules = await getRules();
  const rule = (rules || []).find(r => r.code === 'ISOLATED_ISLAND');
  if (!rule || !rule.enabled) {
    return { skipped: true, reason: 'rule_disabled' };
  }

  const params = rule.params || {};
  const internalRateThreshold =
    typeof params.internal_rate_threshold === 'number' ? params.internal_rate_threshold : 0.6;
  const externalMaxPerUser =
    typeof params.external_max_per_user === 'number' ? params.external_max_per_user : 3;
  const newDays = typeof params.new_days === 'number' ? params.new_days : 7;
  const minSize =
    typeof params.min_cluster_size === 'number' ? params.min_cluster_size : 3;

  const sinceIso = new Date(Date.now() - newDays * 86400 * 1000).toISOString();

  const { data: newUsers, error: usersErr } = await supabase
    .from('users')
    .select('id')
    .gte('created_at', sinceIso);
  if (usersErr) {
    return { error: usersErr.message };
  }
  const newUserIds = (newUsers || []).map(u => u.id);
  if (newUserIds.length < minSize) {
    return { skipped: true, reason: 'too_few_new_users', count: newUserIds.length };
  }

  const edges = await collectInteractionEdges(newUserIds, sinceIso);
  if (edges.length === 0) {
    return { skipped: true, reason: 'no_edges' };
  }

  const adj = buildAdjacency(newUserIds, edges);
  const components = findConnectedComponents(adj).filter(c => c.size >= minSize);

  const summary = { detectedClusters: 0, addedScores: 0, members: 0, components: components.length };

  for (const comp of components) {
    const stats = computeClusterStats(comp, edges);
    if (stats.internalRate < internalRateThreshold) continue;
    if (stats.maxExternal >= externalMaxPerUser) continue;

    const memberArr = Array.from(comp).sort();
    // 24h 内同 member_ids 不重复写
    const dedupSince = new Date(Date.now() - 86400000).toISOString();
    const { data: existing } = await supabase
      .from('account_clusters')
      .select('id')
      .eq('cluster_type', 'isolated_island')
      .gte('created_at', dedupSince)
      .contains('member_ids', memberArr)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const { data: clusterRow, error: insErr } = await supabase
      .from('account_clusters')
      .insert({
        cluster_type: 'isolated_island',
        member_ids: memberArr,
        suspicion_score: Math.min(100, Math.floor(stats.internalRate * 100)),
        evidence: stats,
        status: 'pending',
      })
      .select('id')
      .single();
    if (insErr) {
      console.warn('[isolatedIsland] insert cluster failed:', insErr.message);
      continue;
    }
    summary.detectedClusters++;
    summary.members += memberArr.length;

    for (const uid of memberArr) {
      try {
        const delta = await computeAppliedDelta(uid, rule);
        if (delta <= 0) continue;
        const r = await recordEvent({
          userId: uid,
          ruleCode: 'ISOLATED_ISLAND',
          scoreDelta: delta,
          reason: 'rule_trigger',
          evidence: { cluster_id: clusterRow?.id, ...stats },
        });
        if (r && r.recorded) summary.addedScores += delta;
      } catch (err) {
        console.warn('[isolatedIsland] score trigger failed for', uid, err && err.message);
      }
    }
  }

  return summary;
}

module.exports = { detect };
