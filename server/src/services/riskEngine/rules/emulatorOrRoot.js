// EMULATOR_OR_ROOT: X-Device-Info 里 isRooted 或 isEmulator 为 true
const {
  parseDetailsHeader,
} = require('../../fingerprint/recordFingerprint');

async function evaluate({ req }) {
  const infoHeader =
    req && req.headers && req.headers['x-device-info'];
  if (!infoHeader) return { triggered: false };
  const details = parseDetailsHeader(infoHeader);
  const rooted = Boolean(details.isRooted || details.rooted);
  const emulator = Boolean(details.isEmulator || details.emulator);
  if (!rooted && !emulator) return { triggered: false };
  return {
    triggered: true,
    evidence: { isRooted: rooted, isEmulator: emulator },
  };
}

module.exports = { evaluate };
