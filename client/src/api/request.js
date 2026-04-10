import { API_BASE } from '../config/env';
const BASE_URL = API_BASE;

export function request(options) {
  const token = uni.getStorageSync('token');

  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
