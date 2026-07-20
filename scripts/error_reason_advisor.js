/**
 * error_reason_advisor.js
 * 基于4种粗粒度错因（知识点不会/粗心/时间不够/概念混淆）生成针对性建议。
 *
 * 用途：
 *   - daily_summary.js 晚间总结里加「今日错因分析」段
 *   - weekly_report.js 周报里统计错因趋势
 *   - 任何需要根据 error_reason 给建议的场景
 */

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const DATA_DIR = getDataDir();

// ─── 错因 → 建议库 ──────────────────────────────────────────
// 每种错因一组建议函数，传入 ctx={module,subtype,keywords} 可生成更具体的建议。
const ADVICE = {
  '知识点不会': [
    (ctx) => `这块没吃透，建议回【${ctx.module}·${ctx.subtype || ''}】重学一遍笔记，再刷3道同类题巩固。`,
    ()    => `概念还没建立起来，先看笔记理清逻辑再做题——否则刷多少错多少。`,
  ],
  '粗心': [
    () => `审题时把关键词圈出来，做完用逆向代入法验证一遍答案。`,
    () => `草稿分区写整齐，减少抄错、看错、选反的概率。`,
  ],
  '时间不够': [
    () => `计时训练，单题超90秒先跳，最后回头收尾。`,
    () => `先做擅长模块保底，难题战略性放弃，别在一道题上死磕。`,
  ],
  '概念混淆': [
    (ctx) => `做一张对比表把易混概念并列（围绕${(ctx.keywords || [])[0] || '相似考点'}），练到能一眼区分。`,
    () => `找2道相似题放一起对比分析，抓住关键差异点。`,
  ],
};

// ─── 数据读取 ────────────────────────────────────────────────

function loadWrongQuestions() {
  const p = path.join(DATA_DIR, 'wrong_questions.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (_) { return []; }
}

function getRecentQuestions(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return loadWrongQuestions().filter(q => q.date >= cutoffStr);
}

// ─── 统计 ────────────────────────────────────────────────────

/**
 * 统计近 N 天的错因分布。
 * @returns {{stats: object, total: number, days: number}}
 */
function getErrorReasonStats(days = 7) {
  const recent = getRecentQuestions(days);
  const stats  = { '知识点不会': 0, '粗心': 0, '时间不够': 0, '概念混淆': 0, '未说明': 0 };
  for (const q of recent) {
    const r = q.error_reason || '未说明';
    stats[r] = (stats[r] || 0) + 1;
  }
  return { stats, total: recent.length, days };
}

// ─── 建议生成 ────────────────────────────────────────────────

/**
 * 根据单个错因取一条建议（取第一条，可扩展为轮换）。
 */
function getAdvice(errorReason, ctx = {}) {
  const list = ADVICE[errorReason];
  if (!list || !list.length) return '';
  return list[0](ctx);
}

/**
 * 构建错因分析报告（供晚间总结/周报拼接）。
 * 包含：分布行 + 主导错因(占比) + 针对性建议
 * @returns {string} 多行文本，无数据时返回空串
 */
function buildErrorReasonReport(days = 7) {
  const recent  = getRecentQuestions(days);
  const { stats, total } = getErrorReasonStats(days);
  if (total === 0) return '';

  // 主导错因（排除"未说明"）
  const ranked = Object.entries(stats)
    .filter(([k]) => k !== '未说明')
    .sort(([, a], [, b]) => b - a);
  const [topReason, topCount] = ranked[0] || [];

  if (!topReason || topCount === 0) return '';

  const pct = Math.round(topCount / total * 100);

  // 分布行
  const distLine = ranked
    .filter(([, c]) => c > 0)
    .map(([k, c]) => `${k} ${c}`)
    .join(' / ');

  // 取该主导错因最近一道代表题，让建议更具体
  const repQ = recent
    .filter(q => q.error_reason === topReason)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

  const ctx = repQ
    ? { module: repQ.module, subtype: repQ.subtype, keywords: repQ.keywords }
    : {};
  const advice = getAdvice(topReason, ctx);

  const lines = [
    `错因分析（近${days}天，共${total}题）：${distLine}`,
    `主导错因：${topReason}（${pct}%）`,
  ];
  if (advice) lines.push(advice);
  return lines.join('\n');
}

/**
 * 周报用：对比本周与上周的错因占比，给出趋势。
 * @returns {string}
 */
function buildErrorReasonTrend() {
  const week   = getErrorReasonStats(7);
  const twoWeek = getErrorReasonStats(14);

  if (week.total === 0) return '本周无错题记录。';

  // 上周 = 近14天 - 近7天
  const lastWeekStats = {};
  for (const k of Object.keys(twoWeek.stats)) {
    lastWeekStats[k] = (twoWeek.stats[k] || 0) - (week.stats[k] || 0);
  }

  const lines = [`本周错题 ${week.total} 题，上周 ${Object.values(lastWeekStats).reduce((a,b)=>a+b,0)} 题。`];

  for (const reason of ['知识点不会', '粗心', '时间不够', '概念混淆']) {
    const cur  = week.stats[reason]   || 0;
    const prev = lastWeekStats[reason] || 0;
    if (cur === 0 && prev === 0) continue;
    const delta = cur - prev;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    lines.push(`  ${reason}：本周${cur} / 上周${prev} ${arrow}`);
  }

  // 主导错因建议
  const report = buildErrorReasonReport(7);
  if (report) lines.push('', report);

  return lines.join('\n');
}

module.exports = {
  getErrorReasonStats,
  getAdvice,
  buildErrorReasonReport,
  buildErrorReasonTrend,
};
