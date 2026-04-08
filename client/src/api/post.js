import { get, post, put, del } from './request';

export const getPosts = (page = 1, limit = 20, sort = 'latest') =>
  get(`/posts?page=${page}&limit=${limit}&sort=${sort}`);

export const getPostDetail = (id) => get(`/posts/detail/${id}`);

export const createPost = (content, media_urls = []) =>
  post('/posts', { content, media_urls });

export const deletePost = (id) => del(`/posts/${id}`);

export const editPost = (id, content, media_urls) =>
  put(`/posts/${id}`, { content, ...(media_urls !== undefined ? { media_urls } : {}) });

export const toggleLike = (postId) => post(`/posts/${postId}/like`);

export const getComments = (postId, page = 1) =>
  get(`/posts/${postId}/comments?page=${page}`);

export const addComment = (postId, content) =>
  post(`/posts/${postId}/comments`, { content });
