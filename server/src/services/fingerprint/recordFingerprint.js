// 解析请求 header 里的指纹信息，upsert 到 fingerprints + user_fingerprints
//
// 期望的 header：
//   X-Device-Fingerprint: <sha256 hash 字符串>
//   X-Device-Info: <base64(JSON)>
//   X-App-Signature: <sigSha256|timestamp|hmac>  ← 仅 APK 带，推断 platform=android

const supabase = require('../../config/supabase');

function parseDetailsHeader(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return {};
  try {
    const json = Buffer.from(base64Str, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch (e) {
    return {};
  }
}

function inferPlatform(req) {
  if (req.headers && req.headers['x-app-signature']) return 'android';
  const ua = req.headers && req.headers['user-agent'];
  if (typeof ua === 'string') {
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  }
  return 'web';
}

/**
 * 异步记录指纹 + 关联。失败不抛（不要影响主业务）。
 * @returns {Promise<{present:boolean, hash?:string, id?:string}>}
 */
async function recordFingerprint(req, userId) {
  const hash = req.headers && req.headers['x-device-fingerprint'];
  if (!hash || typeof hash !== 'string') return { present: false };

  const details = parseDetailsHeader(req.headers['x-device-info']);
  const platform = inferPlatform(req);

  try {
    // Upsert fingerprint by hash
    const { data: fp, error: fpErr } = await supabase
      .from('fingerprints')
      .upsert(
        {
          fingerprint_hash: hash,
          platform,
          details,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'fingerprint_hash' }
      )
      .select('id')
      .single();
    if (fpErr || !fp) {
      console.warn('[recordFingerprint] upsert fp failed:', fpErr && fpErr.message);
      return { present: true, hash };
    }

    // 关联到用户（若登录态）
    if (userId) {
      // Simple upsert on composite key
      const { error: linkErr } = await supabase
        .from('user_fingerprints')
        .upsert(
          {
            user_id: userId,
            fingerprint_id: fp.id,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,fingerprint_id' }
        );
      if (linkErr) {
        console.warn('[recordFingerprint] link failed:', linkErr.message);
      }
    }
    return { present: true, hash, id: fp.id };
  } catch (err) {
    console.warn('[recordFingerprint] error:', err && err.message);
    return { present: true, hash };
  }
}

module.exports = { recordFingerprint, parseDetailsHeader, inferPlatform };
