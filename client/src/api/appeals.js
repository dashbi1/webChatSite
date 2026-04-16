import { post, get } from './request';

// 提交申诉
// dto: { contact_email, reason, evidence_urls? }
export const submitAppeal = (dto) => post('/appeals', dto);

// 查自己的申诉历史
export const getMyAppeals = () => get('/appeals/my');
