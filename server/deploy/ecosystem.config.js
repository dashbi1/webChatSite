// PM2 配置文件
// 用法：pm2 start deploy/ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'hit-circle',
      script: './src/app.js',
      cwd: __dirname.replace(/deploy$/, ''),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
