// 调 ip-api.com 免费版补齐 IP 的 ASN / 机房 / 国家等属性
// 文档：https://ip-api.com/docs/api:json
// 免费版限速：45 次/分钟（来自同源 IP），生产环境够用；超限时 fail-open

const FREE_API = 'http://ip-api.com/json';

// 预定义部分 ASN 属于机房/VPS 服务商（ip-api 的 hosting 字段也有此判断，这里是兜底名单）
const DATACENTER_KEYWORDS = [
  'amazon',
  'aws',
  'microsoft',
  'azure',
  'google',
  'oracle',
  'digitalocean',
  'linode',
  'vultr',
  'hetzner',
  'ovh',
  'contabo',
  'tencent',
  'alibaba',
  'aliyun',
  'choopa',
  'ovh',
  'godaddy',
  'cloudflare',
  'leaseweb',
  'colocrossing',
];

function isDatacenterOrg(org) {
  if (!org || typeof org !== 'string') return false;
  const s = org.toLowerCase();
  return DATACENTER_KEYWORDS.some((k) => s.includes(k));
}

async function httpGetJson(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 查询 ip-api.com 并归一化返回
 * @returns {Promise<{asn?:number, asn_org?:string, country?:string, is_datacenter:boolean}>}
 */
async function enrichIp(ipAddress, options = {}) {
  const fetcher = options.fetcher || httpGetJson;
  if (!ipAddress || ipAddress === 'unknown') {
    return { is_datacenter: false };
  }
  try {
    const fields = 'status,country,countryCode,as,asname,isp,org,hosting,proxy';
    const url = `${FREE_API}/${encodeURIComponent(ipAddress)}?fields=${fields}`;
    const data = await fetcher(url);
    if (!data || data.status !== 'success') {
      return { is_datacenter: false };
    }
    // as 格式 "AS12345 SomeOrg"
    let asn = null;
    if (typeof data.as === 'string') {
      const m = data.as.match(/^AS(\d+)/i);
      if (m) asn = parseInt(m[1], 10);
    }
    const org = data.asname || data.isp || data.org || null;
    const is_datacenter =
      Boolean(data.hosting) || Boolean(data.proxy) || isDatacenterOrg(org);
    return {
      asn,
      asn_org: org,
      country: data.countryCode || null,
      is_datacenter,
    };
  } catch (err) {
    console.warn('[enrichIp] failed:', err && err.message);
    return { is_datacenter: false };
  }
}

module.exports = { enrichIp, isDatacenterOrg };
