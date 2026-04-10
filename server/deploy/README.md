# 工大圈子 后端部署指南

## 部署目标
将 Node.js 后端服务部署到 Linux VPS（推荐 Ubuntu 22.04 LTS），使用 PM2 管理进程，Nginx 反向代理，支持 HTTPS。

---

## 方案概览

```
用户 → Nginx (80/443) → Node.js (内部 3000 端口) → Supabase
```

- **PM2**：进程管理，自动重启，日志管理
- **Nginx**：反向代理，HTTPS 终止，WebSocket 支持
- **Certbot**：免费 Let's Encrypt SSL 证书

---

## 部署步骤

### 1. 准备 VPS
- 推荐配置：1 核 1G 内存，10G 磁盘（最低）
- 系统：Ubuntu 22.04 LTS
- 开放端口：22（SSH）、80（HTTP）、443（HTTPS）

### 2. 上传代码到服务器
```bash
# 方式 A：Git 克隆（推荐）
ssh user@YOUR_VPS_IP
git clone https://github.com/YOUR/REPO.git /opt/hit-circle
cd /opt/hit-circle/server

# 方式 B：scp 上传
# 本地执行：
scp -r server user@YOUR_VPS_IP:/opt/hit-circle/
```

### 3. 运行安装脚本
```bash
cd /opt/hit-circle/server/deploy
chmod +x install.sh
sudo ./install.sh
```

脚本会自动：
- 安装 Node.js 20 LTS
- 安装 PM2
- 安装 Nginx
- 安装依赖
- 创建 systemd 服务（通过 PM2）

### 4. 配置 .env
```bash
cd /opt/hit-circle/server
cp .env.example .env
nano .env
```

填入你的 Supabase 配置（从旧的 `.env` 复制）：
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
JWT_SECRET=your-long-random-string
PORT=3000
ADMIN_PATH=console-k8m2x7
```

### 5. 启动服务
```bash
cd /opt/hit-circle/server
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup  # 按提示执行命令，让 PM2 开机自启
```

### 6. 配置 Nginx
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/hit-circle
# 编辑文件，把 YOUR_DOMAIN 改成你的域名或 IP
sudo nano /etc/nginx/sites-available/hit-circle

# 启用配置
sudo ln -s /etc/nginx/sites-available/hit-circle /etc/nginx/sites-enabled/
sudo nginx -t  # 测试配置
sudo systemctl reload nginx
```

### 7.（可选）配置 HTTPS
**前提：有域名并已解析到 VPS**

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
# 按提示操作，自动配置 SSL
```

---

## 常用运维命令

```bash
# 查看服务状态
pm2 status
pm2 logs hit-circle       # 查看日志
pm2 logs hit-circle --lines 100
pm2 restart hit-circle    # 重启
pm2 stop hit-circle       # 停止
pm2 monit                 # 实时监控

# Nginx
sudo systemctl status nginx
sudo systemctl reload nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 更新代码
cd /opt/hit-circle
git pull
cd server
npm install --production
pm2 restart hit-circle
```

---

## 安全建议

1. **修改 SSH 端口**（可选）
2. **禁用 root 登录**，使用 sudo 用户
3. **配置 UFW 防火墙**：
   ```bash
   sudo ufw allow 22
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```
4. **定期更新系统**：`sudo apt update && sudo apt upgrade -y`
5. **备份 .env**（内含 Supabase 密钥）

---

## 前端接入

部署完成后，修改前端配置 `client/src/config/env.js` 中的 `prod` 项：
```js
prod: {
  API_BASE: 'https://yourdomain.com/api',
  SOCKET_URL: 'https://yourdomain.com',
},
```

并将 `CURRENT` 改为 `'prod'` 后重新打包。
