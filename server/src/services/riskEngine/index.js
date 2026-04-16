// 风控引擎入口：给定一个动作（action）和上下文，遍历所有启用规则逐条评估，
// 触发的规则写 risk_events，并（enforce 模式下）累加 users.risk_score。
//
// 使用方式（在路由里）：
//   const { evaluate } = require('../services/riskEngine');
//   await evaluate({
//     user,                      // { id, email, created_at, risk_score, ... }
//     action: 'post_create',     // register / post_create / comment_create / ...
//     req,                       // Express req（用于取 IP / header / 指纹 / APK 签名状态）
//     context: { post },         // 动作相关载荷
//   });

const { getRules } = require('./ruleCache');
const { recordEvent } = require('./scoreStore');
const { computeAppliedDelta } = require('./dedupDecay');

// rules 目录下每个文件导出 { evaluate(args) → {triggered, evidence?} | null }
// args: { user, rule, action, req, context }
// 未注册的规则会被忽略（log warning）
const rulesRegistry = {};

function registerRule(code, impl) {
  rulesRegistry[code] = impl;
}

function getRegisteredRule(code) {
  return rulesRegistry[code];
}

async function evaluate({ user, action, req, context = {} }) {
  if (!user || !user.id) return { triggered: [], errors: [] };

  const rules = await getRules();
  const triggered = [];
  const errors = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const impl = rulesRegistry[rule.code];
    if (!impl || typeof impl.evaluate !== 'function') continue; // 未实现的规则跳过

    try {
      const res = await impl.evaluate({ user, rule, action, req, context });
      if (res && res.triggered) {
        triggered.push({
          code: rule.code,
          rule, // 保留完整 rule 给 dedupDecay 读 params
          score: rule.score,
          evidence: res.evidence || {},
        });
      }
    } catch (err) {
      console.error(`[riskEngine] rule ${rule.code} eval error:`, err && err.message);
      errors.push({ code: rule.code, error: err && err.message });
    }
  }

  // Phase 3 Fix Pack：写入前先过 dedup/decay
  // returns 0 → 跳过不写（不污染 risk_events）
  const writeResults = [];
  for (const t of triggered) {
    const appliedDelta = await computeAppliedDelta(user.id, t.rule);
    if (appliedDelta === 0) {
      continue; // dedup 命中，跳过
    }
    const r = await recordEvent({
      userId: user.id,
      ruleCode: t.code,
      scoreDelta: appliedDelta,
      reason: 'rule_trigger',
      evidence: {
        ...t.evidence,
        ...(appliedDelta !== t.score
          ? { base_score: t.score, applied_delta: appliedDelta }
          : {}),
      },
    });
    writeResults.push(r);
  }

  return { triggered, errors, writeResults };
}

module.exports = { evaluate, registerRule, getRegisteredRule, _rulesRegistry: rulesRegistry };
