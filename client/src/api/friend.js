import { get, post, put, del } from './request';

export const sendFriendRequest = (addresseeId) =>
  post('/friends/request', { addressee_id: addresseeId });

export const getFriendRequests = () => get('/friends/requests');

export const handleFriendRequest = (id, action) =>
  put(`/friends/request/${id}`, { action });

export const getFriends = () => get('/friends');

export const deleteFriend = (id) => del(`/friends/${id}`);
