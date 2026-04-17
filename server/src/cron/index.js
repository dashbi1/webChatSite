// Cron 任务调度入口：app.js 启动时调用 startCron()
// 仅在直接运行（非测试）时启用

const cron = require('node-cron');
const {
  updateDisposableDomains,
} = require('../services/disposableEmails/updateFromGithub');
const { updateAccountCounts } = require('./updateAccountCounts');
const { runIpBurstCheck } = require('./ipBurstCheck');
const { runIsolatedIslandDetect } = require('./isolatedIslandDetect');
const { runDecayRiskScore } = require('./decayRiskScore');
const { runDailyRewardWeeklyActive } = require('./dailyRewardWeeklyActive');
const { runExpireBansCron } = require('./expireBans');
const { runArchiveRiskEventsCron } = require('./archiveRiskEvents');

let started = false;
const tasks = [];

function scheduleTask(expr, name, fn) {
  const task = cron.schedule(
    expr,
    async () => {
      const start = Date.now();
      console.log(`[cron:${name}] start`);
      try {
        await fn();
        console.log(`[cron:${name}] ok ${Date.now() - start}ms`);
      } catch (err) {
        console.error(`[cron:${name}] error:`, err && err.message);
      }
    },
    { scheduled: true }
  );
  tasks.push({ name, task });
  return task;
}

function startCron() {
  if (started) return;
  started = true;

  // 每日 03:00 拉取最新一次性邮箱域名
  scheduleTask('0 3 * * *', 'updateDisposableDomains', updateDisposableDomains);

  // 每 30 分钟更新 fingerprints/ip_records.account_count
  scheduleTask('*/30 * * * *', 'updateAccountCounts', updateAccountCounts);

  // Phase 3：每 10 分钟检测 /24 IP 段注册密集度，命中则临时封 15 分钟
  scheduleTask('*/10 * * * *', 'ipBurstCheck', runIpBurstCheck);

  // Phase 4：孤岛簇检测（每小时整点）
  scheduleTask('0 * * * *', 'isolatedIslandDetect', runIsolatedIslandDetect);

  // Phase 4：风险分时间衰减（每日 02:00）
  scheduleTask('0 2 * * *', 'decayRiskScore', runDecayRiskScore);

  // Phase 4：weekly_active_clean 奖励（每日 03:30，内置 7 天冷却）
  scheduleTask('30 3 * * *', 'dailyRewardWeeklyActive', runDailyRewardWeeklyActive);

  // Phase 4：过期封禁自动解除（每日 04:30）
  scheduleTask('30 4 * * *', 'expireBans', runExpireBansCron);

  // Phase 4：归档 90 天前 risk_events（每周日 04:00）
  scheduleTask('0 4 * * 0', 'archiveRiskEvents', runArchiveRiskEventsCron);

  console.log(`[cron] ${tasks.length} tasks scheduled`);
}

function stopCron() {
  for (const { task } of tasks) task.stop();
  tasks.length = 0;
  started = false;
}

module.exports = { startCron, stopCron };
