import { get, put } from './request';

export const getMe = () => get('/users/me');

export const updateProfile = (data) => put('/users/me', data);

export const searchUsers = (q, page = 1) =>
  get(`/users/search?q=${encodeURIComponent(q)}&page=${page}`);

export const getUserProfile = (id) => get(`/users/${id}`);
