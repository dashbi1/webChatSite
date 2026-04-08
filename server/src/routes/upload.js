const express = require('express');
const multer = require('multer');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const SUPABASE_URL = process.env.SUPABASE_URL;

function publicUrl(bucket, path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// 上传头像
router.post('/avatar', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '未选择文件' });
  }

  const userId = req.user.id;
  const ext = req.file.mimetype.split('/')[1] || 'jpg';
  const filePath = `${userId}/avatar_${Date.now()}.${ext}`;

  // 删除旧头像
  const { data: user } = await supabase
    .from('users')
    .select('avatar_url')
    .eq('id', userId)
    .single();

  if (user?.avatar_url?.includes('/avatars/')) {
    const oldPath = user.avatar_url.split('/avatars/')[1];
    if (oldPath) {
      await supabase.storage.from('avatars').remove([oldPath]);
    }
  }

  // 上传新头像
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    return res.status(500).json({ success: false, error: '头像上传失败' });
  }

  const avatarUrl = publicUrl('avatars', filePath);

  await supabase
    .from('users')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId);

  res.json({ success: true, data: { avatar_url: avatarUrl } });
});

// 上传帖子图片（单张）
router.post('/post-image', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '未选择文件' });
  }

  const userId = req.user.id;
  const ext = req.file.mimetype.split('/')[1] || 'jpg';
  const filePath = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('post-images')
    .upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype,
    });

  if (uploadError) {
    return res.status(500).json({ success: false, error: '图片上传失败' });
  }

  const imageUrl = publicUrl('post-images', filePath);
  res.json({ success: true, data: { url: imageUrl } });
});

module.exports = router;
