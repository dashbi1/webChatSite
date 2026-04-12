# 构建 APK 并安装到真机 - 操作指南

> 前提：后端已部署到公网 VPS（或本机有公网 IP），手机能访问该 IP 的 3000 端口。

---

## 第 1 步：修改后端地址

编辑 `client/src/config/env.js`：

```js
// 1. 把 prod 里的 YOUR_VPS_IP 替换成你的真实公网 IP
prod: {
    API_BASE: 'http://你的公网IP:3000/api',
    SOCKET_URL: 'http://你的公网IP:3000',
},

// 2. 把 CURRENT 改成 'prod'
const CURRENT = 'prod';
```

保存文件。

---

## 第 2 步：构建 H5 产物

在 `client/` 目录下执行：

```bash
cd client
npm run build:h5
```

成功后会输出到 `client/dist/build/h5/` 目录。

---

## 第 3 步：同步到 Android 项目

```bash
cd client
npx cap sync android
```

这一步会把 H5 产物复制到 `client/android/app/src/main/assets/public/`。

---

## 第 4 步：构建 APK

### 方式 A：Android Studio（推荐，不用管 JDK 版本）

1. 打开 Android Studio
2. `File → Open` → 选择 `D:\mine\products\webchat-android\client\android`
3. 等 Gradle Sync 完成（右下角进度条）
4. 菜单 `Build → Build Bundle(s) / APK(s) → Build APK(s)`
5. 构建完成后，右下角弹出 `locate` 链接，点击可打开 APK 所在文件夹

APK 位置：
```
client/android/app/build/outputs/apk/debug/app-debug.apk
```

### 方式 B：命令行（需要 JDK 17）

如果你系统 JDK 是 23，需要先指定 Android Studio 自带的 JDK：

```bash
cd client/android

# Windows - 找到 Android Studio 安装路径下的 jbr 目录
# 例如：set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set JAVA_HOME="你的Android Studio路径\jbr"

gradlew.bat assembleDebug
```

APK 同样在：
```
client/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 第 5 步：安装到真机

把 `app-debug.apk` 传到手机上（任选一种方式）：

- **USB 数据线**：连电脑后 `adb install app-debug.apk`
- **微信/QQ**：发给自己，手机上点击安装
- **网盘**：上传到网盘，手机下载
- **直接传输**：USB 连接后拖进手机存储，手机上点击安装

> 注意：手机需要开启"允许安装未知来源应用"（设置 → 安全 → 安装未知应用）。

---

## 第 6 步：验证

1. 确保后端在公网 IP 上运行（`node src/app.js` 或 pm2）
2. 确保服务器防火墙开放了 3000 端口
3. 手机打开 app → 能看到登录页 → 登录 → 发帖 → 收消息

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 打开 app 白屏 | env.js 里的 IP 不对或后端没启动 | 检查 IP 和端口 |
| 网络请求失败 | 防火墙没开 3000 端口 | 云服务器安全组放行 3000 |
| 安装失败 | 未允许未知来源 | 手机设置里开启 |
| Gradle 构建报 JDK 错误 | JDK 版本太高 | 用方式 A（Android Studio）构建 |

---

## 快速命令汇总（每次改代码后重新出包）

```bash
cd client
npm run build:h5
npx cap sync android
# 然后去 Android Studio 点 Build APK
# APK 在 client/android/app/build/outputs/apk/debug/app-debug.apk
```
