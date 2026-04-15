// 指纹 + IP 记录中间件
// 关键动作路由挂上这个中间件：
//   - 解析 header，异步 upsert fingerprints/ip_records
//   - 异常不阻塞请求
//   - 把 { fingerprint, ip, ipCidr24 } 写到 req.abuse 方便后续规则引擎读取

const { getClientIp, getClientIpCidr24 } = require('../utils/ip');
const { recordFingerprint } = require('../services/fingerprint/recordFingerprint');
const { recordIp } = require('../services/ip/recordIp');

function fingerprintRecorder(options = {}) {
  const { awaitRecords = false } = options;

  return async function fingerprintRecorderMw(req, res, next) {
    const ip = getClientIp(req);
    const ipCidr24 = getClientIpCidr24(req);
    const userId = req.user && req.user.id;

    req.abuse = req.abuse || {};
    req.abuse.ip = ip;
    req.abuse.ipCidr24 = ipCidr24;
    req.abuse.fingerprintHash =
      (req.headers && req.headers['x-device-fingerprint']) || null;

    const tasks = [
      recordFingerprint(req, userId),
      recordIp(ip, userId),
    ];

    if (awaitRecords) {
      try {
        const [fp, ipRec] = await Promise.all(tasks);
        req.abuse.fingerprint = fp;
        req.abuse.ipRecord = ipRec;
      } catch (err) {
        console.warn('[fingerprintRecorder] error:', err && err.message);
      }
      return next();
    }

    // 默认 fire-and-forget（不阻塞响应延迟）
    Promise.all(tasks).catch((e) =>
      console.warn('[fingerprintRecorder] async error:', e && e.message)
    );
    next();
  };
}

module.exports = { fingerprintRecorder };
