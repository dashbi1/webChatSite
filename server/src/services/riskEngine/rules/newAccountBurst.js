// NEW_ACCOUNT_BURST: 24h 内发帖 > max_posts
const supabase = require('../../../config/supabase');

async function evaluate({ user, rule, action }) {
  if (action !== 'post_create') return { triggered: false };
  const windowHours = (rule.params && rule.params.window_hours) || 24;
  const maxPosts = (rule.params && rule.params.max_posts) || 5;

  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gte('created_at', since);
  if (error) return { triggered: false };
  if (!count || count <= maxPosts) return { triggered: false };

  return {
    triggered: true,
    evidence: { posts_in_window: count, window_hours: windowHours },
  };
}

module.exports = { evaluate };
