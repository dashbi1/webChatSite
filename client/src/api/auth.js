import { post } from './request';

// purpose: 'register' | 'reset'
export const sendCode = (email, purpose) =>
  post('/auth/send-code', { email, purpose });

export const register = (data) => post('/auth/register', data);

export const login = (data) => post('/auth/login', data);

export const resetPassword = (data) => post('/auth/reset-password', data);
