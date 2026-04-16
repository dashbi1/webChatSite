// NO_FINGERPRINT: 关键动作请求未携带 X-Device-Fingerprint
async function evaluate({ req }) {
  const hash =
    req && req.headers && req.headers['x-device-fingerprint'];
  if (hash && typeof hash === 'string' && hash.length > 0) {
    return { triggered: false };
  }
  return { triggered: true, evidence: {} };
}

module.exports = { evaluate };
