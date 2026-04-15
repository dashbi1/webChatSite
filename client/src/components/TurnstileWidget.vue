<!--
  Cloudflare Turnstile 人机验证 Widget
  - H5 / Capacitor WebView 环境下渲染 CF Turnstile iframe
  - 用户通过后 emit('success', token) 把一次性 token 交给父组件
  - 父组件把 token 放到请求 body 的 turnstile_token 字段

  用法：
    <TurnstileWidget @success="onTurnstileSuccess" ref="turnstileRef" />
    onTurnstileSuccess(token) { this.turnstileToken = token; }
    // 发请求后：turnstileRef.value.reset(); token 置空
-->
<template>
  <!-- #ifdef H5 -->
  <view class="ts-wrap">
    <view ref="container" class="ts-container" />
    <view v-if="status === 'loading'" class="ts-hint">人机验证加载中...</view>
    <view v-else-if="status === 'error'" class="ts-hint ts-err">
      人机验证加载失败，<text class="ts-retry" @click="reload">点此重试</text>
    </view>
  </view>
  <!-- #endif -->

  <!-- #ifndef H5 -->
  <!-- 非 H5 平台（例如小程序）暂不支持 Turnstile；这里输出空节点，父组件仍可继续 -->
  <view />
  <!-- #endif -->
</template>

<script>
// 改用 Options API：uni-app compiler 对 #ifdef H5 的 setup 解析有时偏弱
import { TURNSTILE_SITE_KEY } from '../config/env';

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptLoading = null;
function loadScript() {
  // #ifdef H5
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load turnstile script failed'));
    document.head.appendChild(s);
  });
  return scriptLoading;
  // #endif
  // eslint-disable-next-line no-unreachable
  return Promise.resolve();
}

export default {
  name: 'TurnstileWidget',
  emits: ['success', 'error', 'expired'],
  data() {
    return {
      status: 'loading', // loading | ready | error
      widgetId: null,
    };
  },
  mounted() {
    // #ifdef H5
    this.init();
    // #endif
  },
  beforeUnmount() {
    // #ifdef H5
    this.destroy();
    // #endif
  },
  methods: {
    async init() {
      // #ifdef H5
      try {
        await loadScript();
        if (!window.turnstile) throw new Error('turnstile not available');
        const el = this.$refs.container;
        if (!el) return;
        this.widgetId = window.turnstile.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => {
            this.$emit('success', token);
          },
          'error-callback': () => {
            this.status = 'error';
            this.$emit('error');
          },
          'expired-callback': () => {
            this.$emit('expired');
          },
        });
        this.status = 'ready';
      } catch (err) {
        console.warn('[Turnstile] init failed:', err && err.message);
        this.status = 'error';
        this.$emit('error');
      }
      // #endif
    },
    reset() {
      // #ifdef H5
      if (this.widgetId !== null && window.turnstile) {
        try { window.turnstile.reset(this.widgetId); } catch (e) {}
      }
      // #endif
    },
    destroy() {
      // #ifdef H5
      if (this.widgetId !== null && window.turnstile) {
        try { window.turnstile.remove(this.widgetId); } catch (e) {}
        this.widgetId = null;
      }
      // #endif
    },
    async reload() {
      this.destroy();
      this.status = 'loading';
      await this.init();
    },
  },
};
</script>

<style scoped>
.ts-wrap {
  margin: 8rpx 0 20rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ts-container {
  min-height: 65px;
}
.ts-hint {
  font-size: 22rpx;
  color: #999;
  margin-top: 8rpx;
}
.ts-err { color: #d94a4a; }
.ts-retry { color: #4A90D9; text-decoration: underline; }
</style>
