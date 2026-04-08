const { createClient } = require('@supabase/supabase-js');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

// 检测是否需要代理（Windows 本地开发环境）
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
let customFetch;

try {
  const dispatcher = new ProxyAgent(PROXY_URL);
  customFetch = (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
  console.log(`[supabase] Using proxy: ${PROXY_URL}`);
} catch {
  customFetch = undefined;
  console.log('[supabase] No proxy, using default fetch');
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
