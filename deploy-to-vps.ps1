# ============================================================
# 工大圈子 - 本地一键部署到 VPS (PowerShell 版)
# ============================================================
# 在 Windows PowerShell 5.1+ 或 PowerShell 7+ 中运行
# 用法：
#   .\deploy-to-vps.ps1
#
# 如果首次提示"执行策略"错误，用这条命令允许（仅当前 session）：
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# 适用场景：
#   - SSH 以普通用户登录（不是 root）；该用户可 sudo
#   - 或者直接 root 登录
#   - sudo 需要密码时会在 step 4 提示输入
#
# 前置依赖（Win10+ 一般自带）：
#   - OpenSSH Client：`ssh` / `scp` 在 PATH 里
#     没有的话：设置 → 应用 → 可选功能 → 添加"OpenSSH 客户端"
#   - Node.js + npm（构建前端用）
# ============================================================

$ErrorActionPreference = 'Stop'

# ============ 在这里填你的配置 ============
$VpsUser   = 'niubi74618'             # 改成你的普通用户名（如 ubuntu / deploy）；保持 root 也行
$VpsIp     = '104.198.91.201'
$VpsDir    = '/opt/hit-circle'

# SSH 私钥路径（可选）
#   - 留空：走默认（~/.ssh/id_rsa / id_ed25519 / ssh-agent / ~/.ssh/config 里的配置）
#   - 填路径：强制指定，所有 ssh/scp 自动加 -i <key>
#   - 路径可以用 $env:USERPROFILE 表示 C:\Users\你
#   - 如路径带空格，注意用单引号包起来
# 示例：
#   $SshKey = "$env:USERPROFILE\.ssh\id_ed25519_vps"
#   $SshKey = 'D:\keys\my-vps.pem'
$SshKey    = 'C:\Users\n\.ssh\google-vps-free-sshKey'
# ==========================================

# 判断是否需要 sudo（非 root 用户时）
$Sudo = ''
if ($VpsUser -ne 'root') { $Sudo = 'sudo' }

# 构造 ssh/scp 的公共参数（key + 保活 + 非交互友好）
$SshOpts = @()
if ($SshKey -ne '') {
  if (-not (Test-Path $SshKey)) {
    Write-Host "[错误] 找不到 SSH 私钥: $SshKey" -ForegroundColor Red
    exit 1
  }
  $SshOpts += '-i', $SshKey
  # 避免某些 key 被 agent 覆盖
  $SshOpts += '-o', 'IdentitiesOnly=yes'
}
# 压掉无害的通道警告（channel_by_id: bad id 等）
$SshOpts += '-o', 'LogLevel=ERROR'

# 远端暂存目录（普通用户可写）
$ts = [int][double]::Parse((Get-Date -UFormat %s))
$RemoteStage = "/tmp/hit-circle-deploy-$ts"
$ScriptDir = $PSScriptRoot
$EnvFile = Join-Path $ScriptDir 'client\src\config\env.js'

Write-Host '====================================='
Write-Host '  工大圈子 - 部署到 VPS (Windows)'
Write-Host "  用户: $VpsUser@$VpsIp"
if ($Sudo -eq '') {
  Write-Host '  模式: root 直接部署'
} else {
  Write-Host '  模式: 普通用户 + sudo 提权'
}
Write-Host '====================================='

# ---------- 前置检查 ----------
function Require-Command([string]$Cmd, [string]$Hint) {
  $c = Get-Command $Cmd -ErrorAction SilentlyContinue
  if (-not $c) {
    Write-Host "[错误] 找不到命令: $Cmd" -ForegroundColor Red
    Write-Host "       $Hint" -ForegroundColor Yellow
    exit 1
  }
}
Require-Command 'ssh' '请安装 OpenSSH Client（设置 → 应用 → 可选功能）或安装 Git for Windows 后重开 PowerShell'
Require-Command 'scp' '请安装 OpenSSH Client（通常和 ssh 一起）'
Require-Command 'npm' '请安装 Node.js (https://nodejs.org/)'

if ($VpsIp -eq 'YOUR_VPS_IP') {
  Write-Host '[错误] 请先编辑本文件，填入 VPS_IP' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $EnvFile)) {
  Write-Host "[错误] 找不到 $EnvFile" -ForegroundColor Red
  exit 1
}

$envContent = Get-Content $EnvFile -Raw
if ($envContent -match 'YOUR_VPS_IP') {
  Write-Host '[错误] client/src/config/env.js 中的 prod 配置还未修改' -ForegroundColor Red
  Write-Host "       请把 YOUR_VPS_IP 替换为实际 IP: $VpsIp" -ForegroundColor Yellow
  exit 1
}
if ($envContent -notmatch "CURRENT\s*=\s*'prod'") {
  Write-Host "[警告] client/src/config/env.js 中 CURRENT 不是 'prod'" -ForegroundColor Yellow
  $ans = Read-Host '是否继续？(y/n)'
  if ($ans -notmatch '^[Yy]') { exit 1 }
}

# ---------- 步骤 1：构建 H5 ----------
Write-Host ''
Write-Host '[1/5] 构建 H5 前端...'
Push-Location (Join-Path $ScriptDir 'client')
try {
  # cmd 包装让 npm.cmd 能正确被调用
  & cmd /c 'npm run build:h5'
  if ($LASTEXITCODE -ne 0) { throw "npm run build:h5 exit $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Host '[完成] H5 构建成功'

# ---------- 步骤 2：远端创建暂存目录 ----------
Write-Host ''
Write-Host '[2/5] 在 VPS /tmp 下创建暂存目录...'
& ssh @SshOpts "$VpsUser@$VpsIp" "mkdir -p $RemoteStage/server $RemoteStage/client"
if ($LASTEXITCODE -ne 0) { Write-Host '[错误] SSH 到 VPS 失败，请检查 ssh 密钥 / VPS 可达性' -ForegroundColor Red; exit 1 }

# ---------- 步骤 3：上传文件 ----------
Write-Host ''
Write-Host '[3/5] 上传文件到 VPS 暂存目录...'

function ScpUpload([string]$Local, [string]$Remote) {
  & scp @SshOpts -r $Local "$VpsUser@$VpsIp`:$Remote"
  if ($LASTEXITCODE -ne 0) { throw "scp 失败: $Local -> $Remote" }
}

Write-Host '  上传后端源码...'
ScpUpload (Join-Path $ScriptDir 'server\src')              "$RemoteStage/server/"
ScpUpload (Join-Path $ScriptDir 'server\admin')            "$RemoteStage/server/"
ScpUpload (Join-Path $ScriptDir 'server\deploy')           "$RemoteStage/server/"
ScpUpload (Join-Path $ScriptDir 'server\package.json')     "$RemoteStage/server/"
ScpUpload (Join-Path $ScriptDir 'server\package-lock.json') "$RemoteStage/server/"
ScpUpload (Join-Path $ScriptDir 'server\.env.example')     "$RemoteStage/server/"

# 可选：jest + 反滥用测试（方便 VPS 上跑 npm run test:abuse）
$jestCfg = Join-Path $ScriptDir 'server\jest.config.js'
$jestSetup = Join-Path $ScriptDir 'server\jest.setup.js'
if (Test-Path $jestCfg) { ScpUpload $jestCfg "$RemoteStage/server/" }
if (Test-Path $jestSetup) { ScpUpload $jestSetup "$RemoteStage/server/" }

$testsDir = Join-Path $ScriptDir 'server\tests'
if (Test-Path $testsDir) {
  ScpUpload $testsDir "$RemoteStage/server/"
}

Write-Host '  上传 H5 前端...'
# 上传整个 h5 目录（PowerShell scp 对 * 展开不友好，直接传目录更稳）
$h5Dir = Join-Path $ScriptDir 'client\dist\build\h5'
if (-not (Test-Path $h5Dir)) {
  Write-Host "[错误] 找不到 H5 构建产物: $h5Dir" -ForegroundColor Red
  exit 1
}
ScpUpload $h5Dir "$RemoteStage/client/"

Write-Host '[完成] 文件上传成功'

# ---------- 步骤 4：远端 sudo rsync 同步到 /opt ----------
Write-Host ''
Write-Host "[4/5] 同步文件到 $VpsDir（使用 rsync，保护 .env）..."
if ($Sudo -ne '') {
  Write-Host '       ↓ 接下来可能会提示输入 sudo 密码' -ForegroundColor Yellow
}

# 构造远端 shell 脚本（rsync 保护 .env 和 node_modules）
$remoteCmd = @"
set -e
$Sudo mkdir -p $VpsDir/server $VpsDir/client/h5
# 后端：--exclude=.env 保护已部署密钥；--exclude=node_modules 避免清空依赖
$Sudo rsync -a --exclude='.env' --exclude='node_modules' $RemoteStage/server/ $VpsDir/server/
# H5 前端：完全同步并清理旧静态文件
$Sudo rsync -a --delete $RemoteStage/client/h5/ $VpsDir/client/h5/
# 清理暂存目录
rm -rf $RemoteStage
# 确保 deploy 脚本可执行
$Sudo chmod +x $VpsDir/server/deploy/install.sh $VpsDir/server/deploy/setup-nginx.sh 2>/dev/null || true
echo 'sync done'
"@

# -t 分配 tty 方便 sudo 交互输入密码
& ssh @SshOpts -t "$VpsUser@$VpsIp" $remoteCmd
if ($LASTEXITCODE -ne 0) {
  Write-Host '[错误] 远端同步失败（sudo 密码错误？或 rsync 未装？）' -ForegroundColor Red
  exit 1
}
Write-Host '[完成] 文件同步成功'

# ---------- 步骤 5：可选运行 install.sh ----------
Write-Host ''
$runInstall = Read-Host '[5/5] 是否在 VPS 上运行 install.sh 安装 Node/PM2/Nginx？(首次部署才需要) (y/N)'
if ($runInstall -match '^[Yy]') {
  & ssh @SshOpts -t "$VpsUser@$VpsIp" "$Sudo $VpsDir/server/deploy/install.sh"
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[错误] install.sh 执行失败' -ForegroundColor Red
    exit 1
  }
  Write-Host '[完成] 安装脚本执行成功'
} else {
  Write-Host '[跳过] 未运行 install.sh'
}

# ---------- 收尾提示 ----------
Write-Host ''
Write-Host '====================================='
Write-Host '  文件上传完成！' -ForegroundColor Green
Write-Host '====================================='
Write-Host ''
Write-Host '在 VPS 上手动完成的事：'
Write-Host ''
Write-Host "  ssh $VpsUser@$VpsIp"
Write-Host ''
Write-Host '  # 如果是**首次部署**，配置 .env'
Write-Host "  cd $VpsDir/server"
Write-Host "  $Sudo cp .env.example .env"
Write-Host "  $Sudo nano .env   # 填 Supabase / Resend / Upstash / Turnstile 等密钥"
Write-Host ''
Write-Host '  # 装/更新依赖（Phase 1/2 新增 @upstash/redis / node-cron / axios 等）'
Write-Host "  cd $VpsDir/server && $Sudo npm install --omit=dev"
Write-Host ''
Write-Host '  # 启动或重启后端'
Write-Host "  $Sudo pm2 restart hit-circle || $Sudo pm2 start $VpsDir/server/deploy/ecosystem.config.js"
Write-Host "  $Sudo pm2 save"
Write-Host ''
Write-Host '  # 首次部署还需配置 Nginx'
Write-Host "  cd $VpsDir/server/deploy"
Write-Host "  $Sudo cp deploy.conf.example deploy.conf"
Write-Host "  $Sudo nano deploy.conf"
Write-Host "  $Sudo ./setup-nginx.sh"
Write-Host ''
Write-Host '  # 验证'
Write-Host "  curl -k https://$VpsIp/api/health"
Write-Host ''
