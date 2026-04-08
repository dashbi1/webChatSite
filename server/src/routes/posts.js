const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取信息流
router.get('/', authMiddleware, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.user.id;

  // 获取帖子
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ success: false, error: '获取帖子失败' });
  }

  // 获取当前用户的好友 ID 列表
  const { data: friendships } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  const friendIds = new Set();
  if (friendships) {
    for (const f of friendships) {
      if (f.requester_id === userId) friendIds.add(f.addressee_id);
      else friendIds.add(f.requester_id);
    }
  }

  // 获取当前用户点赞的帖子
  const postIds = posts.map(p => p.id);
  const { data: userLikes } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);

  const likedPostIds = new Set((userLikes || []).map(l => l.post_id));

  // 批量获取作者信息
  const authorIds = [...new Set(posts.map(p => p.author_id))];
  const { data: authors } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college')
    .in('id', authorIds);

  const authorMap = new Map((authors || []).map(a => [a.id, a]));

  // 组装返回数据
  const result = posts.map(post => ({
    ...post,
    author: authorMap.get(post.author_id) || null,
    is_liked: likedPostIds.has(post.id),
    is_friend: friendIds.has(post.author_id),
    is_self: post.author_id === userId,
  }));

  res.json({ success: true, data: result });
});

// 发布帖子
router.post('/', authMiddleware, async (req, res) => {
  const { content, media_urls = [] } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: '内容不能为空' });
  }
  if (content.length > 1000) {
    return res.status(400).json({ success: false, error: '内容不能超过1000字' });
  }
  if (media_urls.length > 9) {
    return res.status(400).json({ success: false, error: '图片最多9张' });
  }

  const mediaType = media_urls.length > 0 ? 'image' : 'none';

  const { data: inserted, error } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      content: content.trim(),
      media_urls: media_urls,
      media_type: mediaType,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Insert post error:', error);
    return res.status(500).json({ success: false, error: '发布失败' });
  }

  // 单独查作者信息
  const { data: author } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college')
    .eq('id', userId)
    .single();

  res.json({
    success: true,
    data: { ...inserted, author, is_liked: false, is_friend: false, is_self: true },
  });
});

// 删除帖子（自己的）
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data: post } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', id)
    .single();

  if (!post) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }
  if (post.author_id !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '无权删除' });
  }

  await supabase.from('posts').delete().eq('id', id);
  res.json({ success: true });
});

// 编辑帖子
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: '内容不能为空' });
  }

  const { data: post } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', id)
    .single();

  if (!post || post.author_id !== userId) {
    return res.status(403).json({ success: false, error: '无权编辑' });
  }

  const { data: updated, error } = await supabase
    .from('posts')
    .update({ content: content.trim(), is_edited: true })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '编辑失败' });
  }

  res.json({ success: true, data: updated });
});

// 点赞 / 取消点赞
router.post('/:id/like', authMiddleware, async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.user.id;

  // 获取帖子作者
  const { data: post } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .single();

  if (!post) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  // 检查好友关系（自己的帖子也可以点赞）
  if (post.author_id !== userId) {
    const { data: friendship } = await supabase
      .from('friendships')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${post.author_id}),and(requester_id.eq.${post.author_id},addressee_id.eq.${userId})`
      )
      .single();

    if (!friendship) {
      return res.status(403).json({ success: false, error: '添加好友后才能点赞' });
    }
  }

  // 检查是否已点赞
  const { data: existing } = await supabase
    .from('likes')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .single();

  if (existing) {
    // 取消点赞
    await supabase.from('likes').delete().eq('id', existing.id);
    await supabase.rpc('decrement_like_count', { post_id_input: postId });
    res.json({ success: true, data: { liked: false } });
  } else {
    // 点赞
    await supabase.from('likes').insert({ user_id: userId, post_id: postId });
    await supabase.rpc('increment_like_count', { post_id_input: postId });
    res.json({ success: true, data: { liked: true } });
  }
});

// 获取评论列表
router.get('/:id/comments', authMiddleware, async (req, res) => {
  const { id: postId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const { data: comments, error } = await supabase
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ success: false, error: '获取评论失败' });
  }

  // 获取评论者信息
  const commentUserIds = [...new Set(comments.map(c => c.user_id))];
  const { data: commentUsers } = await supabase
    .from('users')
    .select('id, nickname, avatar_url')
    .in('id', commentUserIds.length > 0 ? commentUserIds : ['none']);

  const userMap = new Map((commentUsers || []).map(u => [u.id, u]));
  const enriched = comments.map(c => ({ ...c, user: userMap.get(c.user_id) || null }));

  res.json({ success: true, data: enriched });
});

// 发表评论
router.post('/:id/comments', authMiddleware, async (req, res) => {
  const { id: postId } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: '评论内容不能为空' });
  }

  // 获取帖子作者
  const { data: post } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .single();

  if (!post) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  // 检查好友关系
  if (post.author_id !== userId) {
    const { data: friendship } = await supabase
      .from('friendships')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${post.author_id}),and(requester_id.eq.${post.author_id},addressee_id.eq.${userId})`
      )
      .single();

    if (!friendship) {
      return res.status(403).json({ success: false, error: '添加好友后才能评论' });
    }
  }

  const { data: comment, error } = await supabase
    .from('comments')
    .insert({ user_id: userId, post_id: postId, content: content.trim() })
    .select('*')
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '评论失败' });
  }

  // 附加用户信息
  const { data: commentUser } = await supabase
    .from('users')
    .select('id, nickname, avatar_url')
    .eq('id', userId)
    .single();
  comment.user = commentUser;

  // 更新帖子评论计数
  await supabase.rpc('increment_comment_count', { post_id_input: postId });

  res.json({ success: true, data: comment });
});

module.exports = router;
