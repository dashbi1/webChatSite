import { post } from './request';

export const submitReport = (data) => post('/reports', data);
