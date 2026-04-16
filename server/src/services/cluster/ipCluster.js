// Phase 3 IP /24 段簇查询
// 调用 SQL RPC list_ip_cidr24_clusters

const supabase = require('../../config/supabase');

/**
 * @param {{ minAccounts?: number, limit?: number }} opts
 * @returns {Promise<Array>}
 */
async function listIpClusters({ minAccounts = 3, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('list_ip_cidr24_clusters', {
    p_min_accounts: minAccounts,
    p_limit: limit,
  });
  if (error) {
    console.warn('[ipCluster] RPC error:', error.message);
    return [];
  }
  return data || [];
}

module.exports = { listIpClusters };
