// 环境配置 - 根据需要切换 API 地址
//
// 使用方法：修改 CURRENT 变量为对应的键名
//   - 'dev'      : H5 本地开发（浏览器访问 localhost）
//   - 'avd'      : Android Studio AVD 模拟器（宿主机映射 10.0.2.2）
//   - 'lan'      : 真机测试（同 WiFi，改成你电脑的局域网 IP）
//   - 'prod'     : 生产环境（云 VPS）
//
// 打包发布 APK 前记得改成 'prod'
//
// prod 模式采用运行时判断：
//   - APK（Capacitor）→ 走 APK_API_HOST（app.domain）
//   - 浏览器          → 用 window.location.origin（www.domain，H5 部署在哪就用哪）

const CONFIGS = {
  dev: {
    API_BASE: 'http://localhost:3000/api',
    SOCKET_URL: 'http://localhost:3000',
  },
  avd: {
    API_BASE: 'http://10.0.2.2:3000/api',
    SOCKET_URL: 'http://10.0.2.2:3000',
  },
  lan: {
    // ⚠️ 改成你电脑的局域网 IP
    API_BASE: 'http://192.168.1.100:3000/api',
    SOCKET_URL: 'http://192.168.1.100:3000',
  },
  prod: {
    // APK 专用：Capacitor 环境下一定走这个 host
    APK_API_HOST: 'https://app.agent666.xyz',
    // 浏览器兜底：运行时一般用 window.location.origin，这里仅作 SSR / 极端兜底
    WEB_FALLBACK_HOST: 'https://www.agent666.xyz',
  },
};

const CURRENT = 'prod';

function resolveProdEndpoints() {
  const { APK_API_HOST, WEB_FALLBACK_HOST } = CONFIGS.prod;

  // 检测是否运行在 Capacitor（APK）里
  const isCapacitor =
    typeof window !== 'undefined' &&
    (window.Capacitor !== undefined || window.capacitor !== undefined);

  if (isCapacitor) {
    return { API_BASE: APK_API_HOST + '/api', SOCKET_URL: APK_API_HOST };
  }

  // 浏览器：用当前页面的 origin，访问 www.domain 时就是 www.domain
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const origin = window.location.origin;
    return { API_BASE: origin + '/api', SOCKET_URL: origin };
  }

  // SSR / 极端兜底
  return { API_BASE: WEB_FALLBACK_HOST + '/api', SOCKET_URL: WEB_FALLBACK_HOST };
}

function resolveEndpoints() {
  if (CURRENT === 'prod') return resolveProdEndpoints();
  const c = CONFIGS[CURRENT];
  return { API_BASE: c.API_BASE, SOCKET_URL: c.SOCKET_URL };
}

const endpoints = resolveEndpoints();

export const API_BASE = endpoints.API_BASE;
export const SOCKET_URL = endpoints.SOCKET_URL;
export const UPLOAD_URL = API_BASE.replace('/api', '/api/upload');

// ============================================================
// Cloudflare Turnstile 站点密钥（人机验证）
// 详见 docs/anti-abuse/08-deployment.md 第 A.2 节
//
// 开发 / 测试可使用官方 "永远通过" 的 key：
//   1x00000000000000000000AA
//
// 上线前必须替换成在 Cloudflare 后台创建 Site 后拿到的正式 Site Key，
// 并在该 Site 的 Hostname 列表里加上：
//   - www.yourdomain.com / app.yourdomain.com（生产域名）
//   - localhost（Capacitor Android WebView 默认 origin）
// ============================================================
export const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
