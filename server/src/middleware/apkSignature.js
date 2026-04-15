// APK 签名 HMAC 强校验
// 详见 docs/anti-abuse/03-architecture.md 第 4 节
//
// X-App-Signature 格式：sigSha256|timestamp|hmac
//   sigSha256: APK 在运行时读取自身签名的 SHA256（小写十六进制）
//   timestamp: Unix 秒级时间戳
//   hmac: HmacSHA256(APK_HMAC_SECRET, "sigSha256|timestamp|userId")
//
// 中间件**不拒绝请求**（status 通过 req.apkSignatureStatus 传给规则引擎决定加分）
//   - 'absent'         → 非 APK 请求（H5），跳过（不加分）
//   - 'valid'          → 校验通过
//   - 'bad_format'     → header 格式不对
//   - 'expired'        → 时间戳漂移 > 5 分钟
//   - 'sig_mismatch'   → signature SHA256 不在白名单
//   - 'hmac_mismatch'  → HMAC 不匹配（HMAC 密钥不对）
//
// 对应 Phase 2 规则 APK_SIGNATURE_FAIL 会在 status ∈ {bad_format,expired,sig_mismatch,hmac_mismatch} 时 +45

const crypto = require('crypto');

const MAX_CLOCK_DRIFT_SEC = 300;

function normalizeHex(s) {
  return typeof s === 'string' ? s.toLowerCase().replace(/[^0-9a-f]/g, '') : '';
}

function getAllowedSigs() {
  const raw = process.env.ALLOWED_APK_SIGNATURES || '';
  return raw
    .split(',')
    .map((s) => normalizeHex(s))
    .filter((s) => s.length > 0);
}

function getHmacSecrets() {
  // 支持 APK_HMAC_SECRET 单值或 APK_HMAC_SECRETS 逗号分隔（兼容旧密钥过渡）
  const multi = process.env.APK_HMAC_SECRETS;
  if (multi) {
    return multi.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const single = process.env.APK_HMAC_SECRET;
  return single ? [single.trim()] : [];
}

function expectedHmac(secret, sigSha256, timestamp, userId) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${sigSha256}|${timestamp}|${userId || ''}`)
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function apkSignatureCheck(req, res, next) {
  const header = req.headers && req.headers['x-app-signature'];
  if (!header || typeof header !== 'string') {
    req.apkSignatureStatus = 'absent';
    return next();
  }

  const parts = header.split('|');
  if (parts.length !== 3) {
    req.apkSignatureStatus = 'bad_format';
    return next();
  }
  const [sigSha256Raw, timestampStr, hmacRaw] = parts;
  const sigSha256 = normalizeHex(sigSha256Raw);
  const hmac = normalizeHex(hmacRaw);
  const timestamp = parseInt(timestampStr, 10);

  if (!sigSha256 || !hmac || !Number.isFinite(timestamp)) {
    req.apkSignatureStatus = 'bad_format';
    return next();
  }

  // 时间戳漂移校验（防重放）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_CLOCK_DRIFT_SEC) {
    req.apkSignatureStatus = 'expired';
    return next();
  }

  // SHA256 白名单校验
  const allowed = getAllowedSigs();
  if (allowed.length === 0 || !allowed.includes(sigSha256)) {
    req.apkSignatureStatus = 'sig_mismatch';
    return next();
  }

  // HMAC 校验（支持多密钥兼容过渡）
  const secrets = getHmacSecrets();
  if (secrets.length === 0) {
    // 未配置密钥，后端不完整，视为 hmac_mismatch
    req.apkSignatureStatus = 'hmac_mismatch';
    return next();
  }
  const userId = (req.user && req.user.id) || '';
  const ok = secrets.some((secret) =>
    timingSafeEqualHex(expectedHmac(secret, sigSha256, timestamp, userId), hmac)
  );
  req.apkSignatureStatus = ok ? 'valid' : 'hmac_mismatch';
  next();
}

module.exports = {
  apkSignatureCheck,
  // 暴露工具方便测试
  expectedHmac,
  normalizeHex,
  getAllowedSigs,
  getHmacSecrets,
};
