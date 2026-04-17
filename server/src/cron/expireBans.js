// Cron wrapper：过期封禁清理（每日 04:30）
const { runExpireBans } = require('../services/enforcement/expireBans');

async function runExpireBansCron() {
  const result = await runExpireBans();
  console.log('[cron:expireBans] result:', JSON.stringify(result));
  return result;
}

module.exports = { runExpireBansCron };
