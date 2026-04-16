// ISOLATED_ISLAND: 孤岛互动簇 — 实时 rule 不评估，由 Phase 4 cron 检测后通过
// evidence 传入触发。此 impl 只在 context 里带 cluster_evidence 时触发。
async function evaluate({ action, context }) {
  // 仅当 cron 通过 trigger 路径调用，action='cluster_detected'，带 cluster_evidence
  if (action !== 'cluster_detected') return { triggered: false };
  const ev = context && context.cluster_evidence;
  if (!ev) return { triggered: false };
  return {
    triggered: true,
    evidence: ev,
  };
}

module.exports = { evaluate };
