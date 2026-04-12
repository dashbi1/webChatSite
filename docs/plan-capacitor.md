# 工大圈子 - Capacitor 打包 Android APK 迁移方案

> 目标：跳过 HBuilderX，用 Capacitor 把 uni-app H5 产物打包成 APK，装到 Android Studio 的 Pixel 7 AVD 模拟器上跑起来。
>
> 验证成功标准：模拟器里装上 APK → 启动后能看到登录页 → 能登录（调到后端 API）→ 能发帖 → 能收 socket 实时消息。

---

## 0. 背景与决策

### 为什么换方案
- **原路径失败**：HBuilderX 云打包 / `dev:app` 推流到 Pixel AVD 一直显示同一个初始页，无论前端代码怎么改都不刷新。具体根因不明（可能是 HBuilderX 的热推流走的是旧产物缓存）。
- **决定绕开 HBuilderX**，走"uni-app → H5 静态产物 → Capacitor 壳 → APK"这条旁路。

### 技术选型确认
| 项 | 选型 | 原因 |
|----|------|------|
| 前端框架 | uni-app 3.x (Vue 3 + Vite) | 现状，不动 |
| H5 产物 | `dist/build/h5/`（uni-app 默认） | `npm run build:h5` 产出 |
| 打包壳 | **Capacitor 6.x** | 对应 JDK 17，你机器上就是 17 |
| 目标设备 | Pixel 7 AVD（Android Studio 模拟器） | 用户指定 |
| 后端连接 | `http://10.0.2.2:3000`（AVD → 宿主机映射） | `env.js` 里已预留 `avd` 配置 |
| JDK | JDK 17 | 用户确认 |
| 相机相册 | **仅浏览器 `<input type="file">`**，不装 `@capacitor/camera` 插件 | 用户确认"先能跑就行" |

### 非目标（本轮不做）
- ❌ 相机直拍（降级为相册选图）
- ❌ 推送通知
- ❌ 部署到 VPS（等本轮通了再改 `env.js` 切 `prod`）
- ❌ iOS 打包
- ❌ 真机（非 AVD）调试
- ❌ APK 签名发布（用 debug 签名跑通就行）

---

## 1. 项目结构（改动后）

```
D:\mine\products\webchat-android\
├── client\                      ← uni-app 前端（Capacitor 集成在这里）
│   ├── android\                  ← [新增] Capacitor 生成的 Android 原生项目
│   ├── dist\
│   │   └── build\
│   │       └── h5\               ← [新增] uni build 的 H5 产物，Capacitor 的 webDir
│   ├── src\
│   │   ├── config\env.js         ← [修改] CURRENT='avd'
│   │   ├── manifest.json         ← [修改] 加 h5 段配置
│   │   └── ...
│   ├── capacitor.config.json     ← [新增] Capacitor 配置
│   └── package.json              ← [修改] 加 @capacitor/* 依赖
├── server\                       ← 后端（基本不动）
├── architectures\
└── docs\
    └── plan-capacitor.md         ← 本文件
```

**关键决策**：Capacitor 集成在 `client\` 目录下，而不是项目根。这样：
- `capacitor.config.json` 和 `package.json` 同级，CLI 命令正常工作
- 生成的 `android\` 目录也在 `client\` 下，跟 H5 产物同一棵树
- 不污染项目根

---

## 2. 详细执行步骤

### 阶段 A：前端配置调整（改 3 个文件）

#### A1. 切换 API 地址到 AVD 模式
**文件**：`client\src\config\env.js`

**改动**：第 33 行
```diff
- const CURRENT = 'dev';
+ const CURRENT = 'avd';
```

**验证**：`API_BASE` 应为 `http://10.0.2.2:3000/api`，`SOCKET_URL` 应为 `http://10.0.2.2:3000`。

**背景**：
- AVD 模拟器里的 `localhost` 指的是模拟器自己，不是宿主机。
- Android 模拟器把宿主机的 `127.0.0.1` 映射到 `10.0.2.2`，这是 Google 官方约定。
- 后端继续跑在宿主机的 `localhost:3000`，不动。

#### A2. 给 manifest.json 加 H5 相对路径
**文件**：`client\src\manifest.json`

**改动**：在文件末尾 `"vueVersion": "3"` 前加一段 `"h5"` 配置
```diff
    "uniStatistics": {
        "enable": false
    },
+   "h5" : {
+       "router" : {
+           "base" : "./",
+           "mode" : "hash"
+       },
+       "publicPath" : "./"
+   },
    "vueVersion" : "3"
}
```

**为什么**：
- Capacitor 用 `http://localhost/` 服务静态文件，理论上绝对路径 `/` 也能工作
- 但保险起见配成相对路径 `./`，避免 `file://` 协议降级场景下白屏
- `router.mode: 'hash'` 强制哈希路由 `#/pages/...`，WebView 里对路由最稳

#### A3. 执行 H5 打包
```bash
cd D:\mine\products\webchat-android\client
npm run build:h5
```

**产出**：`client\dist\build\h5\` 目录，里面应该有：
- `index.html`
- `assets\` (JS/CSS 资源)
- `static\` (图片等)

**验证**：
- `index.html` 存在
- 打开 `index.html` 看 `<script>` / `<link>` 的 src 是否是相对路径（应为 `./assets/xxx.js`）
- 如果路径是绝对的 `/assets/xxx.js`，说明 manifest 配置没生效，需要回头检查

---

### 阶段 B：后端配置确认（几乎不用改）

#### B1. 确认 Express 监听在所有接口
**文件**：`server\src\app.js` 第 63 行
```js
server.listen(PORT, () => { ... });
```
Node 的 `server.listen(PORT)` 默认监听 `::`（所有接口），**所以无需改动**。AVD 通过 `10.0.2.2:3000` 能触达。

#### B2. 确认 CORS 开全
第 24 行：
```js
app.use(cors());
```
第 57 行：
```js
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
```
✅ 已经全开，**无需改动**。

#### B3. 启动后端
```bash
cd D:\mine\products\webchat-android\server
npm run dev
```
保持终端开着，不要关。

**验证**：浏览器访问 `http://localhost:3000/api/health` 应返回 `{status:"ok",...}`。

---

### 阶段 C：Capacitor 集成（在 client\ 目录下）

#### C1. 安装 Capacitor 依赖
```bash
cd D:\mine\products\webchat-android\client

npm i @capacitor/core@^6.0.0
npm i -D @capacitor/cli@^6.0.0
npm i @capacitor/android@^6.0.0
```

**注意**：**必须锁 `^6.0.0`**，Capacitor 7 要 JDK 21，跟你的 JDK 17 不兼容。

#### C2. 初始化 Capacitor
```bash
npx cap init
```

交互式提示，按下面回答：
```
? App name: 工大圈子
? App Package ID (e.g. com.example.app): com.hit.circle
? Web asset directory: dist/build/h5
```

这会生成 `client\capacitor.config.json`。

#### C3. 修改 `capacitor.config.json` 加入明文 HTTP 支持
生成后打开 `client\capacitor.config.json`，改成：
```json
{
  "appId": "com.hit.circle",
  "appName": "工大圈子",
  "webDir": "dist/build/h5",
  "server": {
    "androidScheme": "http",
    "cleartext": true
  }
}
```

**关键**：
- `androidScheme: "http"` — 让 WebView 以 `http://localhost/` 方式服务本地资源（而不是默认的 `https://localhost/`，避免某些 http 请求被 mixed content 拦截）
- `cleartext: true` — 允许明文 HTTP 流量，**这是最容易漏的坑**。Android 9+ 默认禁 cleartext，不加这个配置 APK 访问 `http://10.0.2.2:3000` 会直接被拦截，表现为：白屏 / 所有请求失败但没有明显错误。

#### C4. 添加 Android 平台
```bash
npx cap add android
```

这会：
- 创建 `client\android\` 目录（一个完整的 Android Studio 项目）
- 自动把 `dist/build/h5/` 的内容复制到 `client\android\app\src\main\assets\public\`
- 根据 `capacitor.config.json` 生成 `AndroidManifest.xml`、`build.gradle` 等

#### C5. 同步（如果后面改了前端代码）
```bash
npm run build:h5   # 重新打包 H5
npx cap sync       # 把新产物同步到 android/
```

**这是后续开发的核心循环**。每次前端改动要重新跑这两条命令。

---

### 阶段 D：Android Studio 打包 APK

#### D1. 打开 Android Studio 项目
在 Android Studio 里：**File → Open → 选 `D:\mine\products\webchat-android\client\android` 目录**

（不用 `npx cap open android`，因为 `ANDROID_HOME` 没配，手动打开更稳。）

#### D2. Gradle Sync
首次打开会自动触发 Gradle Sync，要下载一堆依赖，**大概 5-15 分钟**（取决于网速）。

**可能的坑**：
- Gradle 从 Maven 中央仓库下载慢 → 可以加阿里云镜像（Plan 的阶段 E 讨论）
- JDK 版本冲突 → Android Studio 设置里指定：`File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK = 17`

#### D3. 确认 Gradle JDK 为 17
`File → Settings → Build, Execution, Deployment → Build Tools → Gradle`
- `Gradle JDK` 选 `17`（Android Studio embedded JDK 如果是 17 就选它，不是就手动指定）

#### D4. 启动 Pixel 7 AVD
- `Tools → Device Manager` → 找到 Pixel 7 → 点启动
- 等模拟器完全开机

#### D5. 运行 APK 到 AVD
两种方式（任选）：

**方式 1（推荐，直接调试）**：
- Android Studio 顶部工具栏选目标设备为 Pixel 7
- 点 ▶ Run 'app'
- Android Studio 会自动 build + 装 APK + 启动

**方式 2（纯打包 APK 文件）**：
- `Build → Build Bundle(s) / APK(s) → Build APK(s)`
- 右下角弹窗点 `locate` 找到生成的 `app-debug.apk`
- 手动用 `adb install` 或拖到模拟器里安装

**第一次推荐方式 1**，有 Logcat 直接看错误。

---

### 阶段 E：验证与常见坑排查

#### E1. 启动后看什么
APK 装上后启动，期望：
1. ✅ 看到 uni-app 的启动页（或直接进登录页）
2. ✅ 登录页能正常渲染（不是白屏）
3. ✅ 输入手机号+验证码能登录（Network 请求到 `10.0.2.2:3000` 成功）
4. ✅ 登录后能看到信息流
5. ✅ 发帖、收 socket 消息正常

#### E2. 典型故障排查表

| 症状 | 可能原因 | 排查 / 修复 |
|------|---------|------------|
| **白屏** | H5 资源路径错了 | 在 Android Studio **Logcat** 里过滤 `Capacitor` / `WebView`，看 `Failed to load resource`。常见：manifest.json 的 `h5.publicPath='./'` 没生效 → 重新 `build:h5` + `cap sync` |
| **白屏 + Logcat 里 ERR_CLEARTEXT_NOT_PERMITTED** | `cleartext` 没开 | 检查 `capacitor.config.json`，补 `server.cleartext=true`，重新 `cap sync` |
| **启动页正常，但登录请求失败** | AVD 连不到后端 | (1) 后端真的在跑？浏览器访问 `localhost:3000/api/health`；(2) `env.js` 是不是 `avd`；(3) Windows 防火墙是不是挡了 3000 端口 |
| **登录成功但 socket 连不上** | WebSocket 走 polling 降级或 CORS | 看 Logcat，socket.io 会自动降级 `websocket → polling`，一般能通。如果还不行，看后端日志是不是收到连接 |
| **Gradle sync 失败，JDK 不匹配** | 默认 JDK 版本不对 | Settings → Gradle → Gradle JDK 强制选 17 |
| **Gradle 下载依赖超时** | 网络 | 在 `client\android\build.gradle` 顶部 `repositories` 里加阿里云镜像（见下） |

#### E3. 阿里云镜像（如 Gradle 慢）
编辑 `client\android\build.gradle`（项目级），改 `buildscript.repositories` 和 `allprojects.repositories`：
```gradle
repositories {
    maven { url 'https://maven.aliyun.com/repository/google' }
    maven { url 'https://maven.aliyun.com/repository/public' }
    google()
    mavenCentral()
}
```

---

## 3. 文件改动清单（总结）

| 文件 | 动作 | 说明 |
|------|------|------|
| `client\src\config\env.js` | 修改 | `CURRENT` 从 `'dev'` 改 `'avd'` |
| `client\src\manifest.json` | 修改 | 加 `"h5"` 段（`publicPath`、`router`） |
| `client\package.json` | 自动更新 | `npm i @capacitor/*` 后会自动改 |
| `client\capacitor.config.json` | 新增 | `npx cap init` 生成，再手动加 `server.cleartext` |
| `client\android\**` | 新增（整棵树） | `npx cap add android` 生成，不手动编辑，当黑盒 |
| `client\dist\build\h5\**` | 新增（构建产物） | `npm run build:h5` 生成 |
| `server\**` | **不动** | CORS 和监听地址已经 OK |

---

## 4. 执行顺序检查表

编码阶段按这个顺序执行，每步打勾：

- [ ] 1. 改 `client\src\config\env.js` → `CURRENT='avd'`
- [ ] 2. 改 `client\src\manifest.json` → 加 h5 段
- [ ] 3. `cd client && npm run build:h5` → 看 `dist\build\h5\index.html` 是否生成
- [ ] 4. 确认后端启动：`cd server && npm run dev`（新终端，保持运行）
- [ ] 5. 浏览器访问 `http://localhost:3000/api/health` → 返回 ok
- [ ] 6. `cd client && npm i @capacitor/core@^6.0.0 @capacitor/android@^6.0.0` + `npm i -D @capacitor/cli@^6.0.0`
- [ ] 7. `npx cap init`（按上文交互回答）
- [ ] 8. 编辑 `capacitor.config.json` 加 `server.cleartext/androidScheme`
- [ ] 9. `npx cap add android` → `client\android\` 生成
- [ ] 10. `npx cap sync`
- [ ] 11. Android Studio → File → Open → `client\android`
- [ ] 12. Gradle Sync（等完）
- [ ] 13. Settings 里确认 Gradle JDK = 17
- [ ] 14. 启动 Pixel 7 AVD
- [ ] 15. 点 Run → 装 APK → 启动
- [ ] 16. 验证：登录 + 发帖 + 收消息

---

## 5. 回退方案

如果 Capacitor 路径也跑不通，备选：

1. **uni-app 官方本地离线打包** — 下载 Android 离线 SDK，手动集成到 Android Studio 项目（比 Capacitor 复杂，但是 uni-app 官方路径）
2. **继续排查 HBuilderX 云打包的原因** — 很可能只是某个缓存问题
3. **纯 Web** — 放弃 APK，H5 部署到 VPS，用户通过浏览器访问

---

## 6. 已知风险（剩余 5%）

1. **uni-app H5 产物的相对路径细节**：`manifest.json` 的 `h5.publicPath` 在 uni-app 3.x 不同小版本行为可能略有差异。如果 build 后 `index.html` 里路径不对，备选是在 `vite.config.js` 里手动设置 `base: './'`。
2. **Capacitor 6 + Gradle + JDK 17 首次 sync**：可能因为国内网络慢导致超时。有阿里云镜像方案兜底。
3. **Socket.io 在 WebView 里的 WebSocket 握手**：理论上走 `http://10.0.2.2:3000` 能通，但如果 upgrade 到 `ws://` 被拦，Socket.io 客户端会自动降级 polling，不影响功能。

---

## 7. 完成定义 (Definition of Done)

本方案完成的标准：
- ✅ `client\android\app\build\outputs\apk\debug\app-debug.apk` 存在
- ✅ 该 APK 装到 Pixel 7 AVD 能启动
- ✅ 启动后能完成：登录 → 查看信息流 → 发一条纯文字帖 → 和另一个账号私聊收到消息
- ✅ 不要求相机直拍、不要求推送、不要求 HTTPS、不要求发布签名
