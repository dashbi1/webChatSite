// Phase 3 账号簇统一出口
// type: 'fingerprint' / 'ip_cidr24'
// Phase 4 扩展：'isolated_island' / 'simhash_similar'

const { listFingerprintClusters } = require('./fingerprintCluster');
const { listIpClusters } = require('./ipCluster');

async function listClusters({ type = 'fingerprint', minAccounts = 3, limit = 50 } = {}) {
  if (type === 'fingerprint') {
    return listFingerprintClusters({ minAccounts, limit });
  }
  if (type === 'ip_cidr24') {
    return listIpClusters({ minAccounts, limit });
  }
  return [];
}

module.exports = {
  listClusters,
  listFingerprintClusters,
  listIpClusters,
};
