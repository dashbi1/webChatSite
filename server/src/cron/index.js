// Cron 任务调度入口：app.js 启动时调用 startCron()
// 仅在直接运行（非测试）时启用

const cron = require('node-cron');
const {
  updateDisposableDomains,
} = require('../services/disposableEmails/updateFromGithub');

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

  console.log(`[cron] ${tasks.length} tasks scheduled`);
}

function stopCron() {
  for (const { task } of tasks) task.stop();
  tasks.length = 0;
  started = false;
}

module.exports = { startCron, stopCron };
