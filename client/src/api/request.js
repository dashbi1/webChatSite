import { API_BASE } from '../config/env';
import { getFingerprint, encodeDetails } from '../utils/fingerprint';

const BASE_URL = API_BASE;

// 包装 uni.request 以便：
//   - 自动附加 JWT
//   - 自动附加设备指纹 header（失败不阻塞）
//   - 统一错误处理（401 踢出登录；403 BANNED；其余 >=400 toast）
export function request(options) {
  const token = uni.getStorageSync('token');

  return new Promise(async (resolve, reject) => {
    // 反滥用：尝试拿指纹；失败不阻塞
    let fpHeaders = {};
    try {
      const fp = await getFingerprint();
      if (fp && fp.hash) {
        fpHeaders['X-Device-Fingerprint'] = fp.hash;
        const encoded = encodeDetails(fp.details);
        if (encoded) fpHeaders['X-Device-Info'] = encoded;
      }
    } catch (e) {
      // 忽略
    }

    uni.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...fpHeaders,
        ...options.header,
      },
      success(res) {
        if (res.statusCode === 401) {
          uni.removeStorageSync('token');
          uni.removeStorageSync('user');
          uni.reLaunch({ url: '/pages/login/index' });
          reject(new Error('未登录'));
          return;
        }
        if (res.statusCode === 403 && res.data?.code === 'BANNED') {
          uni.removeStorageSync('token');
          uni.removeStorageSync('user');
          uni.showModal({
            title: '账号已被封禁',
            content: '您的账号因违规已被封禁，请联系管理员',
            showCancel: false,
            success: () => uni.reLaunch({ url: '/pages/login/index' }),
          });
          reject(new Error('账号已被封禁'));
          return;
        }
        // Phase 3：账号冻结/审核中（仅对关键动作返回此码）
        if (res.statusCode === 403 && res.data?.code === 'UNDER_REVIEW') {
          uni.showToast({
            title: res.data.error || '账号审核中，暂时无法进行此操作',
            icon: 'none',
          });
          reject(new Error(res.data.error || '账号审核中'));
          return;
        }
        // Phase 3：功能尚未开放（如申诉 appeals_enabled=false）
        if (res.statusCode === 503 && res.data?.code === 'COMING_SOON') {
          uni.showToast({
            title: res.data.error || '功能开发中，敬请期待',
            icon: 'none',
          });
          reject(new Error(res.data.error || '功能开发中'));
          return;
        }
        if (res.statusCode >= 400) {
          const msg = res.data?.error || '请求失败';
          uni.showToast({ title: msg, icon: 'none' });
          reject(new Error(msg));
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        uni.showToast({ title: '网络错误', icon: 'none' });
        reject(err);
      },
    });
  });
}

export const get = (url, data) => request({ url, method: 'GET', data });
export const post = (url, data) => request({ url, method: 'POST', data });
export const put = (url, data) => request({ url, method: 'PUT', data });
export const del = (url, data) => request({ url, method: 'DELETE', data });
