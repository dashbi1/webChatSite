const { createClient } = require('@supabase/supabase-js');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

// 代理配置逻辑：
// - 生产环境（NODE_ENV=production）或 NO_PROXY=true：不走代理
// - 否则使用 HTTPS_PROXY / HTTP_PROXY 或默认 http://127.0.0.1:7897（本地开发）
const isProd = process.env.NODE_ENV === 'production';
const noProxy = process.env.NO_PROXY === 'true' || isProd;
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';

let customFetch;

if (noProxy) {
  customFetch = undefined;
  console.log('[supabase] Production/NO_PROXY mode, using default fetch');
} else {
  try {
    const dispatcher = new ProxyAgent(PROXY_URL);
    customFetch = (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
    console.log(`[supabase] Using proxy: ${PROXY_URL}`);
  } catch {
    customFetch = undefined;
    console.log('[supabase] Proxy init failed, using default fetch');
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    ...(customFetch ? { global: { fetch: customFetch } } : {}),
  }
);

module.exports = supabase;
