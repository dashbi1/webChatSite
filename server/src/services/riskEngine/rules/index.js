// 规则注册入口：被 app.js 启动时 require 一次，把所有规则注册到风控引擎
const { registerRule } = require('../index');

const mapping = {
  REGISTER_QUICK_POST: require('./registerQuickPost'),
  NEW_ACCOUNT_BURST: require('./newAccountBurst'),
  SIMHASH_SIMILAR: require('./simhashSimilar'),
  DEVICE_MULTI_ACCOUNT: require('./deviceMultiAccount'),
  IP_CIDR24_BURST: require('./ipCidr24Burst'),
  ASN_DATACENTER: require('./asnDatacenter'),
  COLD_EMAIL_DOMAIN: require('./coldEmailDomain'),
  DEFAULT_PROFILE: require('./defaultProfile'),
  ISOLATED_ISLAND: require('./isolatedIsland'),
  APK_SIGNATURE_FAIL: require('./apkSignatureFail'),
  EMULATOR_OR_ROOT: require('./emulatorOrRoot'),
  NO_FINGERPRINT: require('./noFingerprint'),
};

function registerAll() {
  for (const [code, impl] of Object.entries(mapping)) {
    registerRule(code, impl);
  }
}

module.exports = { registerAll, mapping };
