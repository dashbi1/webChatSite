// 设备指纹采集（H5 + Capacitor APK）
// 基于 FingerprintJS Open Source（MIT 协议）
//
// 用法：
//   import { getFingerprint } from '@/utils/fingerprint';
//   const fp = await getFingerprint();   // { hash, details }
//
// 行为：
//   - 首次调用时异步加载 FingerprintJS + 采集组件，后续直接读缓存
//   - 失败（网络、CSP、浏览器禁用）→ 返回 null，调用方照常发请求（后端规则 NO_FINGERPRINT 会 +5）
//   - 浏览器/APK 同一套代码：APK 的 WebView 也是 H5 运行时

let cache = null;
let loading = null;

const COLLECT_TIMEOUT_MS = 2500;

// 提取 FingerprintJS.components 里我们关心的稳定字段
function pickStableDetails(components) {
  if (!components || typeof components !== 'object') return {};
  const pick = (k) => {
    const c = components[k];
    if (!c) return undefined;
    // FingerprintJS 的 component 格式 { value } 或 { error }
    return c.value !== undefined ? c.value : undefined;
  };
  return {
    userAgent: pick('userAgent'),
    timezone: pick('timezone'),
    language: pick('languages'),
    platform: pick('platform'),
    hardwareConcurrency: pick('hardwareConcurrency'),
    colorDepth: pick('colorDepth'),
    deviceMemory: pick('deviceMemory'),
    screenResolution: pick('screenResolution'),
    // 激进维度（服务端规则里的设备识别依赖）
    canvas: pick('canvas') ? 'present' : 'absent',
    webgl: pick('webgl') ? 'present' : 'absent',
    audio: pick('audio') ? 'present' : 'absent',
    fonts: pick('fonts') ? (Array.isArray(pick('fonts')) ? pick('fonts').length : 'present') : 'absent',
  };
}

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('fingerprint timeout')), ms)
    ),
  ]);
}

async function collect() {
  // 动态 import 避免启动时阻塞；FingerprintJS 较大（~70KB gzipped）
  const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
  const agent = await FingerprintJS.load({ monitoring: false });
  const result = await agent.get();
  return {
    hash: result.visitorId,
    details: pickStableDetails(result.components),
  };
}

/**
 * 获取设备指纹。返回 Promise<{hash, details} | null>。
 * 失败时返回 null（不抛，调用方照常发请求）。
 */
export async function getFingerprint() {
  if (cache) return cache;
  if (loading) return loading;

  loading = (async () => {
    try {
      const fp = await withTimeout(collect(), COLLECT_TIMEOUT_MS);
      cache = fp;
      return fp;
    } catch (err) {
      // 指纹采集失败不阻塞业务；日志留痕便于排查
      // eslint-disable-next-line no-console
      console.warn('[fingerprint] collect failed:', err && err.message);
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * 返回 X-Device-Info header 的 base64(JSON)；没有指纹时返回 null。
 */
export function encodeDetails(details) {
  if (!details || typeof details !== 'object') return null;
  try {
    const json = JSON.stringify(details);
    // 浏览器端：TextEncoder + btoa；Node（测试）：Buffer
    if (typeof btoa === 'function') {
      // eslint-disable-next-line no-undef
      return btoa(unescape(encodeURIComponent(json)));
    }
    return Buffer.from(json, 'utf8').toString('base64');
  } catch (e) {
    return null;
  }
}

// 测试钩子
export function _resetCache() {
  cache = null;
  loading = null;
}
