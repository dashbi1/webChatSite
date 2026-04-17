// Cron wrapper：风险分时间衰减（每日 02:00）
const { runDecay } = require('../services/decay/timeDecay');

async function runDecayRiskScore() {
  const result = await runDecay();
  console.log('[cron:decayRiskScore] result:', JSON.stringify(result));
  return result;
}

module.exports = { runDecayRiskScore };
