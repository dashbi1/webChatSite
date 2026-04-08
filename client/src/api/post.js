import { get, post, put, del } from './request';

export const getPosts = (page = 1, limit = 20) =>
  get(`/posts?page=${page}&limit=${limit}`);

export const createPost = (content, media_urls = []) =>
  post('/posts', { content, media_urls });

export const deletePost = (id) => del(`/posts/${id}`);

export const editPost = (id, content) => put(`/posts/${id}`, { content });

export const toggleLike = (postId) => post(`/posts/${postId}/like`);

export const getComments = (postId, page = 1) =>
  get(`/posts/${postId}/comments?page=${page}`);

export const addComment = (postId, content) =>
  post(`/posts/${postId}/comments`, { content });
