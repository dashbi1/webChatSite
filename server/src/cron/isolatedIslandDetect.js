// Cron wrapper：孤岛簇检测（每小时 0 分）
const { detect } = require('../services/cluster/isolatedIslandDetect');

async function runIsolatedIslandDetect() {
  const result = await detect();
  console.log('[cron:isolatedIsland] result:', JSON.stringify(result));
  return result;
}

module.exports = { runIsolatedIslandDetect };
