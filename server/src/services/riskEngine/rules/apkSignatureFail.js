// APK_SIGNATURE_FAIL: X-App-Signature 校验失败（非 absent/valid）
// 依赖 apkSignatureCheck 中间件先运行设置 req.apkSignatureStatus
async function evaluate({ req }) {
  const status = req && req.apkSignatureStatus;
  if (!status) return { triggered: false };
  if (status === 'absent' || status === 'valid') return { triggered: false };
  // bad_format / expired / sig_mismatch / hmac_mismatch → 触发
  return {
    triggered: true,
    evidence: { status },
  };
}

module.exports = { evaluate };
