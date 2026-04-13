// 环境配置 - 根据需要切换 API 地址
//
// 使用方法：修改 CURRENT 变量为对应的键名
//   - 'dev'      : H5 本地开发（浏览器访问 localhost）
//   - 'avd'      : Android Studio AVD 模拟器（宿主机映射 10.0.2.2）
//   - 'lan'      : 真机测试（同 WiFi，改成你电脑的局域网 IP）
//   - 'prod'     : 生产环境（云 VPS）
//
// 打包发布 APK 前记得改成 'prod'

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
    // ⚠️ 部署前必改：换成你的 VPS 公网 IP（走 Nginx 反向代理，无需端口号）
    API_BASE: 'https://agent666.xyz/api',
    SOCKET_URL: 'https://agent666.xyz',
  },
};

// 当前使用的环境
const CURRENT = 'prod';

export const API_BASE = CONFIGS[CURRENT].API_BASE;
export const SOCKET_URL = CONFIGS[CURRENT].SOCKET_URL;
export const UPLOAD_URL = API_BASE.replace('/api', '/api/upload');
