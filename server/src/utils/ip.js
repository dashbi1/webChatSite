// 真实客户端 IP 解析（支持 ip / cloudflare / cloudflare-split 三种部署模式）
// 详见 docs/anti-abuse/03-architecture.md 第 3 节
//
// 安全说明：
//   - 在 cloudflare / cloudflare-split 模式下，**优先**取 CF-Connecting-IP。
//     该 header 由 CF 边缘节点注入；客户端绕过 CF 直连 VPS 并伪造时，
//     Nginx 层 set_real_ip_from + real_ip_header 会**忽略**伪造值，
//     配合 proxy_set_header CF-Connecting-IP $http_cf_connecting_ip
//     （或 Nginx 层面的 real_ip 覆盖）保证安全。
//   - 在 ip 模式下，用 req.ip（Express trust proxy=1 会从 X-Forwarded-For 取）。
//   - X-Real-IP 作为兜底（部分旧网关仍用）。
//   - 部署模式通过 DEPLOY_MODE 环境变量控制；未设置时退化为 ip 模式。

function getDeployMode() {
  const m = (process.env.DEPLOY_MODE || 'ip').toLowerCase();
  if (m === 'cloudflare' || m === 'cloudflare-split') return 'cloudflare';
  return 'ip';
}

function pickRawIp(req) {
  const mode = getDeployMode();
  if (mode === 'cloudflare') {
    return (
      req.headers['cf-connecting-ip'] ||
      req.ip ||
      req.headers['x-real-ip'] ||
      (req.connection && req.connection.remoteAddress) ||
      'unknown'
    );
  }
  // ip 模式
  return (
    req.ip ||
    req.headers['x-real-ip'] ||
    (req.connection && req.connection.remoteAddress) ||
    'unknown'
  );
}

function getClientIp(req) {
  const raw = pickRawIp(req);
  if (typeof raw !== 'string') return 'unknown';
  // 去掉 IPv4-mapped IPv6 前缀（::ffff:1.2.3.4 → 1.2.3.4）
  return raw.replace(/^::ffff:/, '');
}

// /24 段（用于 IP 段限流和聚类）。IPv6 返回 null（Phase 1 暂不支持）。
function getClientIpCidr24(req) {
  const ip = getClientIp(req);
  if (ip === 'unknown') return null;
  if (ip.includes(':')) return null; // IPv6
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

module.exports = { getClientIp, getClientIpCidr24, getDeployMode };
