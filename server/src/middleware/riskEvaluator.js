// 风控评估中间件工厂
// 用法（在路由 business logic 之后挂）：
//   router.post('/posts',
//     authMw,
//     fingerprintRecorder({ awaitRecords: true }),
//     apkSignatureCheck,
//     createPostBusinessLogic,
//     riskEvaluator({ action: 'post_create', extractContext: (req) => ({ post: req._createdPost }) })
//   );
//
// 中间件在响应已发送（res.locals.post 已设）后异步评估；评估失败不影响响应。

const { evaluate } = require('../services/riskEngine');

function riskEvaluator({ action, extractContext = () => ({}) }) {
  return async function riskEvaluatorMw(req, res, next) {
    // 响应后异步评估：不阻塞
    const run = async () => {
      try {
        if (!req.user || !req.user.id) return;
        const context = extractContext(req, res) || {};
        await evaluate({ user: req.user, action, req, context });
      } catch (err) {
        console.error('[riskEvaluator] error:', err && err.message);
      }
    };
    // 在 res finish 后再跑，避免阻塞
    res.on('finish', () => { run(); });
    next();
  };
}

module.exports = { riskEvaluator };
