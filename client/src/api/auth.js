import { post } from './request';

// purpose: 'register' | 'reset'
// turnstileToken: Cloudflare Turnstile 通过后拿到的一次性 token（H5 必传；若未启用后端 Turnstile 可传空）
export const sendCode = (email, purpose, turnstileToken) =>
  post('/auth/send-code', {
    email,
    purpose,
    turnstile_token: turnstileToken,
  });

export const register = (data) => post('/auth/register', data);

export const login = (data) => post('/auth/login', data);

export const resetPassword = (data) => post('/auth/reset-password', data);
