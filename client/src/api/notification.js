import { get, put } from './request';

export const getNotifications = (page = 1, limit = 20) =>
  get(`/notifications?page=${page}&limit=${limit}`);

export const getUnreadCount = () => get('/notifications/unread-count');

export const markAsRead = (id) => put(`/notifications/${id}/read`);
