// Phase 4：收集新用户之间的互动边 + 构图 + 连通子图 + 统计孤岛簇指标
// 边语义（Q20=A，无向去重）：
//   - friendships status='accepted'：requester_id ↔ addressee_id
//   - likes 经 RPC list_new_user_likes：liker ↔ post.author_id
//   - comments 经 RPC list_new_user_comments：commenter ↔ post.author_id

const supabase = require('../../config/supabase');

/**
 * @param {string[]} newUserIds
 * @param {string} sinceIso ISO 时间字符串
 * @returns {Promise<Array<[string, string]>>} 无向边数组
 */
async function collectInteractionEdges(newUserIds, sinceIso) {
  if (!Array.isArray(newUserIds) || newUserIds.length < 2) return [];

  const { data: frs } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .in('requester_id', newUserIds)
    .in('addressee_id', newUserIds)
    .eq('status', 'accepted');

  const { data: lks } = await supabase.rpc('list_new_user_likes', {
    p_user_ids: newUserIds,
    p_since: sinceIso,
  });

  const { data: cms } = await supabase.rpc('list_new_user_comments', {
    p_user_ids: newUserIds,
    p_since: sinceIso,
  });

  const rawEdges = [
    ...(frs || []).map(e => [e.requester_id, e.addressee_id]),
    ...(lks || []).map(e => [e.actor_id, e.target_id]),
    ...(cms || []).map(e => [e.actor_id, e.target_id]),
  ];

  const seen = new Set();
  const result = [];
  for (const [a, b] of rawEdges) {
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [first, second] = key.split('|');
    result.push([first, second]);
  }
  return result;
}

function buildAdjacency(userIds, edges) {
  const adj = new Map();
  for (const u of userIds) adj.set(u, new Set());
  for (const [a, b] of edges) {
    if (adj.has(a) && adj.has(b)) {
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
  }
  return adj;
}

function findConnectedComponents(adj) {
  const visited = new Set();
  const components = [];
  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    const comp = new Set();
    const queue = [node];
    while (queue.length > 0) {
      const n = queue.shift();
      if (visited.has(n)) continue;
      visited.add(n);
      comp.add(n);
      const neighbors = adj.get(n);
      if (neighbors) {
        for (const nb of neighbors) {
          if (!visited.has(nb)) queue.push(nb);
        }
      }
    }
    if (comp.size > 0) components.push(comp);
  }
  return components;
}

/**
 * 计算一个 component（Set<userId>）的指标
 *   internal  —— 内部边数（无向）
 *   internalRate = internal / possibleInternal，possibleInternal = size*(size-1)/2
 *   maxExternal  —— 任一成员对外互动边数最大值
 * 全量 edges 传入（含 component 内部和外部）
 */
function computeClusterStats(component, edges) {
  const members = new Set(component);
  const size = members.size;
  let internal = 0;
  const externalByUser = {};
  for (const [a, b] of edges) {
    const aIn = members.has(a);
    const bIn = members.has(b);
    if (aIn && bIn) internal++;
    else if (aIn) externalByUser[a] = (externalByUser[a] || 0) + 1;
    else if (bIn) externalByUser[b] = (externalByUser[b] || 0) + 1;
  }
  const possibleInternal = size * (size - 1) / 2;
  const internalRate = possibleInternal > 0 ? internal / possibleInternal : 0;
  const maxExternal = Object.values(externalByUser).reduce(
    (m, v) => Math.max(m, v),
    0
  );
  return { size, internal, internalRate, maxExternal };
}

module.exports = {
  collectInteractionEdges,
  buildAdjacency,
  findConnectedComponents,
  computeClusterStats,
};
