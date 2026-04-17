// Cron wrapper：归档 90 天前 risk_events（每周日 04:00）
const { runArchive } = require('../services/archive/archiveRiskEvents');

async function runArchiveRiskEventsCron() {
  const result = await runArchive(90);
  console.log('[cron:archiveRiskEvents] result:', JSON.stringify(result));
  return result;
}

module.exports = { runArchiveRiskEventsCron };
