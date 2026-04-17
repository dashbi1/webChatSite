const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const { apkSignatureCheck } = require('../middleware/apkSignature');
const { fingerprintRecorder } = require('../middleware/fingerprintRecorder');
const { riskEnforcer } = require('../middleware/riskEnforcer');
const { triggerRiskEval } = require('../services/riskEngine/triggerAsync');
const { shouldShadowPost } = require('../services/enforcement/shadowBan');
const { getSystemConfig } = require('../services/config/systemConfig');
const {
  rewardPostLikedByStranger,
  rewardCommentReplied,
} = require('../services/decay/positiveReward');

const router = express.Router();

function isVideoUrl(url) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('/post-videos/');
}

function getMediaType(urls) {
  if (!urls || urls.length === 0) return 'none';
  const hasImage = urls.some(u => !isVideoUrl(u));
  const hasVideo = urls.some(u => isVideoUrl(u));
  if (hasImage && hasVideo) return 'mixed';
  if (hasVideo) return 'video';
  return 'image';
}

// 获取单条帖子详情
router.get('/detail/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data: post, error } = await supabase
    .from('posts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !post) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  const { data: author } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college')
    .eq('id', post.author_id)
    .single();

  res.json({
    success: true,
    data: { ...post, author, is_self: post.author_id === userId },
  });
});

// 获取信息流（Phase 3：shadow 帖子只对作者本人可见）
router.get('/', authMiddleware, async (req, res) => {
  const { page = 1, limit = 20, sort = 'latest' } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.user.id;

  // 获取帖子
  let posts, error;
  if (sort === 'hot') {
    const result = await supabase.rpc('get_hot_posts', { p_offset: Number(offset), p_limit: Number(limit) });
    posts = result.data;
    error = result.error;
    // 对热门排序也做 shadow 过滤（内存层，避免改 SQL 函数）
    if (!error && Array.isArray(posts)) {
      posts = posts.filter((p) => !p.shadow_ban || p.author_id === userId);
    }
  } else {
    const result = await supabase.rpc('get_timeline_posts', {
      current_user_id: userId,
      p_limit: Number(limit),
      p_offset: Number(offset),
    });
    posts = result.data;
    error = result.error;
  }

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

// 发布帖子（反滥用：记录指纹/IP + APK 签名校验 + 风控冻结拦截 + shadow 抽样 + 异步规则评估）
router.post('/', authMiddleware, riskEnforcer(), apkSignatureCheck, fingerprintRecorder(), async (req, res) => {
  const { content, media_urls = [] } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: '内容不能为空' });
  }
  if (content.length > 1000) {
    return res.status(400).json({ success: false, error: '内容不能超过1000字' });
  }
  if (media_urls.length > 9) {
    return res.status(400).json({ success: false, error: '附件最多9个' });
  }

  const mediaType = getMediaType(media_urls);

  // Phase 3：shadow 用户按 sample_rate 抽样写 shadow_ban=true（别人刷不到）
  const sampleRate = Number(await getSystemConfig('shadow_ban_sample_rate', 0.5));
  const shadow = shouldShadowPost(req.user, sampleRate);

  const { data: inserted, error } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      content: content.trim(),
      media_urls: media_urls,
      media_type: mediaType,
      shadow_ban: shadow,
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

  // 反滥用：异步评估 post_create 规则
  //   REGISTER_QUICK_POST / NEW_ACCOUNT_BURST / SIMHASH_SIMILAR 等
  triggerRiskEval(userId, 'post_create', req, { post: inserted });

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
  const { content, media_urls } = req.body;
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

  const updateData = { content: content.trim(), is_edited: true };
  if (media_urls !== undefined) {
    updateData.media_urls = media_urls;
    updateData.media_type = media_urls.length > 0 ? 'image' : 'none';
  }

  const { data: updated, error } = await supabase
    .from('posts')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '编辑失败' });
  }

  res.json({ success: true, data: updated });
});

// 点赞 / 取消点赞（Phase 3：冻结拒、shadow 用户"假点赞"）
router.post('/:id/like', authMiddleware, riskEnforcer(), async (req, res) => {
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
    // Phase 3 shadow：按 sample_rate 抽样"假点赞"（不写 likes + 不累加计数）
    const sampleRate = Number(await getSystemConfig('shadow_ban_sample_rate', 0.5));
    if (shouldShadowPost(req.user, sampleRate)) {
      return res.json({ success: true, data: { liked: true } });
    }
    // 正常点赞
    await supabase.from('likes').insert({ user_id: userId, post_id: postId });
    await supabase.rpc('increment_like_count', { post_id_input: postId });
    res.json({ success: true, data: { liked: true } });

    // Phase 4：陌生人点赞 → 作者减分（异步不阻塞）
    setImmediate(async () => {
      try {
        await rewardPostLikedByStranger({
          postId,
          authorId: post.author_id,
          likerId: userId,
        });
      } catch (e) {
        console.warn('[reward:post_liked] failed:', e && e.message);
      }
    });
  }
});

// 获取评论列表（Phase 3：shadow 评论只对作者本人可见）
router.get('/:id/comments', authMiddleware, async (req, res) => {
  const { id: postId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const viewerId = req.user.id;

  const { data: comments, error } = await supabase.rpc('get_post_comments_visible', {
    p_post_id: postId,
    current_user_id: viewerId,
    p_limit: Number(limit),
    p_offset: Number(offset),
  });

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

// 发表评论（Phase 3：冻结拒、shadow 抽样）
router.post('/:id/comments', authMiddleware, riskEnforcer(), async (req, res) => {
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

  // Phase 3 shadow：shadow 用户评论按 sample_rate 抽样写 shadow_ban=true
  const sampleRate = Number(await getSystemConfig('shadow_ban_sample_rate', 0.5));
  const shadow = shouldShadowPost(req.user, sampleRate);

  const { data: comment, error } = await supabase
    .from('comments')
    .insert({ user_id: userId, post_id: postId, content: content.trim(), shadow_ban: shadow })
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

  // 更新帖子评论计数（shadow 评论不计入公开计数）
  if (!shadow) {
    await supabase.rpc('increment_comment_count', { post_id_input: postId });
  }

  res.json({ success: true, data: comment });

  // Phase 4：评论非 shadow 时 → 作者减分（异步不阻塞）
  if (!shadow) {
    setImmediate(async () => {
      try {
        await rewardCommentReplied({
          authorId: post.author_id,
          replierId: userId,
          postId,
          commentId: comment.id,
        });
      } catch (e) {
        console.warn('[reward:comment_replied] failed:', e && e.message);
      }
    });
  }
});

module.exports = router;
