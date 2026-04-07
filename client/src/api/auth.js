import { post } from './request';

export const sendCode = (phone) => post('/auth/send-code', { phone });

export const register = (data) => post('/auth/register', data);

export const login = (data) => post('/auth/login', data);
