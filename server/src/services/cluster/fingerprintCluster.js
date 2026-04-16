// Phase 3 指纹簇查询
// 调用 SQL RPC list_fingerprint_clusters

const supabase = require('../../config/supabase');

/**
 * @param {{ minAccounts?: number, limit?: number }} opts
 * @returns {Promise<Array>}
 */
async function listFingerprintClusters({ minAccounts = 3, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('list_fingerprint_clusters', {
    p_min_accounts: minAccounts,
    p_limit: limit,
  });
  if (error) {
    console.warn('[fingerprintCluster] RPC error:', error.message);
    return [];
  }
  return data || [];
}

module.exports = { listFingerprintClusters };
