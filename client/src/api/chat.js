import { get } from './request';

export const getConversations = () => get('/messages/conversations');

export const getMessages = (friendId, page = 1) =>
  get(`/messages/${friendId}?page=${page}`);
