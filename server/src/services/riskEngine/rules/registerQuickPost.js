// REGISTER_QUICK_POST: 注册后 N 分钟内发首帖
const supabase = require('../../../config/supabase');

async function evaluate({ user, rule, action }) {
  if (action !== 'post_create') return { triggered: false };
  if (!user.created_at) return { triggered: false };
  const thresholdMin = (rule.params && rule.params.threshold_minutes) || 5;

  const elapsedMin =
    (Date.now() - new Date(user.created_at).getTime()) / 60000;
  if (elapsedMin >= thresholdMin) return { triggered: false };

  // 必须是首帖：用 head + count 查
  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id);
  if (error) return { triggered: false };
  if (count !== 1) return { triggered: false };

  return {
    triggered: true,
    evidence: {
      registered_min_ago: Math.round(elapsedMin * 10) / 10,
    },
  };
}

module.exports = { evaluate };
