/**
 * review_reminder.js
 * 基于艾宾浩斯遗忘曲线的复习提醒。
 *
 * 排期逻辑（见 eb_schedule.js）：
 *   每道题按 1→2→4→7→15→30→60→120 天的间隔排期复习；
 *   用户自评「记得」→ 推进到下一个更长间隔；
 *   自评「忘了」→ 间隔重置回第 1 天（明天再复习）；
 *   走完整个周期（8 次）→ 自动标记为「已掌握」。
 *
 * 由 cron 每日触发（建议 20:00）。只推送「今天到期」的题，
 * 不再随机抽题；存量旧题首次运行时会错峰导入，避免一次性涌入。
 *
 * workspace.yaml 配置（见 assets/workspace-example.yaml）：
 *   cron: "0 20 * * *"  每天 20:00
 *   script: skills/ApexNotes/scripts/review_reminder.js
 *
 * 状态文件：
 *   data/review_state.json   每道题的遗忘曲线状态，key 为题目 id
 *   data/review_session.json 当前进行中的复习会话（逐题回复用）
 */

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');
const {
  EB_INTERVALS,
  initStateStaggered,
  initState,
  processReview,
  isDue,
  nextIntervalDays,
} = require('./eb_schedule');

const DATA_DIR     = getDataDir();
const WQ_PATH      = path.join(DATA_DIR, 'wrong_questions.json');
const STATE_PATH   = path.join(DATA_DIR, 'review_state.json');
const SESSION_PATH = path.join(DATA_DIR, 'review_session.json');

// 每天最多推送的复习题数（超出部分留在队列，明天继续）
const MAX_PER_DAY = 8;

// ─── 工具函数 ─────────────────────────────────────────────────

function loadJson(p, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return fallback; }
}

function saveJson(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function loadQuestions() {
  return loadJson(WQ_PATH, []);
}

function loadState() {
  return loadJson(STATE_PATH, {});
}

function loadById(id) {
  return loadQuestions().find(q => q.id === id) || null;
}

function countPending() {
  return loadQuestions().filter(q => q.status !== '已掌握').length;
}

// ─── 状态初始化（存量题错峰 / 新题在入库时初始化） ──────────────

/**
 * 为所有「待复习且无状态」的存量题补建错峰状态。
 * 不直接修改错题记录本身，只写 review_state.json。
 * @returns {object} 最新 state
 */
function ensureStates() {
  const questions = loadQuestions();
  const state     = loadState();
  let changed = false;

  for (const q of questions) {
    if (q.status === '已掌握') continue;
    if (!state[q.id]) {
      state[q.id] = initStateStaggered(q.id, q.date);
      changed = true;
    }
  }
  if (changed) saveJson(STATE_PATH, state);
  return state;
}

// ─── 抽题：只抽今天到期的 ─────────────────────────────────────

/**
 * 选出今天到期（含逾期）的待复习题，按到期日升序（最该复习的排前）。
 * @param {number} maxPerDay 每日上限
 */
function pickDueQuestions(maxPerDay = MAX_PER_DAY) {
  const questions = loadQuestions();
  const state     = loadState();

  const due = questions.filter(q =>
    q.status !== '已掌握' && state[q.id] && isDue(state[q.id])
  );

  due.sort((a, b) => state[a.id].next_due.localeCompare(state[b.id].next_due));
  return due.slice(0, maxPerDay);
}

// ─── 题面格式化 ───────────────────────────────────────────────

function formatQuestion(q) {
  const lines = [`[${q.module} · ${q.subtype || ''}]`];
  if (q.question_text) lines.push(q.question_text.slice(0, 200));
  if (q.visual_description) lines.push(`图形描述：${q.visual_description.slice(0, 150)}`);
  if (q.answer) lines.push(`正确答案：${q.answer}`);
  lines.push(`知识点：${(q.keywords || []).join('、') || '未标记'}`);
  return lines.join('\n');
}

/**
 * 带进度说明的题面（如「第 3 次复习 / 距上次 4 天」）。
 */
function formatQuestionWithProgress(q, state) {
  const st     = state[q.id] || {};
  const stage  = st.stage || 0;
  const last   = st.last_reviewed || st.learn_date || q.date;
  const gap    = require('./eb_schedule').daysBetween(last, require('./eb_schedule').todayStr());
  const header = `（第 ${stage + 1} 次复习，距上次 ${gap} 天）`;
  return `${header}\n${formatQuestion(q)}`;
}

// ─── 主推送（cron 触发） ──────────────────────────────────────

function buildReminderMessage() {
  ensureStates();
  const due = pickDueQuestions();

  if (!due.length) {
    return '📚 按遗忘曲线，今天没有到期复习的题，保持手感就好。';
  }

  const state = loadState();
  const session = {
    date:      new Date().toISOString().slice(0, 10),
    questions: due.map(q => q.id),
    current:   0,
    answers:   {},
  };
  saveJson(SESSION_PATH, session);

  const first = due[0];
  const intervalLabel = EB_INTERVALS.join('→');
  return [
    `📚 遗忘曲线复习时间到`,
    `今天有 ${due.length} 道到期（间隔：${intervalLabel} 天）`,
    '',
    `第 1 / ${due.length} 道 ${formatQuestionWithProgress(first, state)}`,
    '',
    '还记得解法吗？回复 记得 / 不记得',
  ].join('\n');
}

// ─── 处理用户回复（在 parse_input.js 的 handleMessage 里调用） ──

/**
 * 检测是否有进行中的复习会话，并处理用户的「记得/不记得」回复。
 * @returns {string|null} 要发送的下一条消息，null 表示没有进行中的会话
 */
function handleReviewReply(userText) {
  if (!fs.existsSync(SESSION_PATH)) return null;

  const session = loadJson(SESSION_PATH, null);
  if (!session || session.current >= session.questions.length) return null;

  const text       = (userText || '').trim();
  const isRemember = /记得|会了|掌握|对|知道/.test(text);
  const isForget   = /不记得|忘了|不会|错了|不对|不知道/.test(text);
  if (!isRemember && !isForget) return null;  // 不是对复习的回复

  const currentId = session.questions[session.current];
  const state     = loadState();
  const st        = state[currentId] || initState(currentId);

  processReview(st, isRemember);
  state[currentId] = st;
  saveJson(STATE_PATH, state);

  let feedback;
  if (isRemember) {
    if (st.graduated) {
      markMastered(currentId);
      feedback = '✅ 走完遗忘曲线，这道题已彻底掌握！';
    } else {
      const next = nextIntervalDays(st);
      feedback = `记得 ✓ 已巩固。下次复习：${st.next_due}（${next} 天后）。`;
    }
  } else {
    feedback = `标记「忘了」。明天会再出现，多过一遍就熟了。`;
  }

  session.current += 1;
  saveJson(SESSION_PATH, session);

  if (session.current >= session.questions.length) {
    const remaining = countPending();
    const dueLeft   = pickDueQuestions().length;
    return `${feedback}\n\n本次复习完成！待复习池还剩 ${remaining} 道，明天到期约 ${dueLeft} 道。`;
  }

  const nextQ = loadById(session.questions[session.current]);
  if (!nextQ) return `${feedback}\n\n（下一道题找不到了，本次复习结束）`;

  return [
    feedback,
    '',
    `第 ${session.current + 1} / ${session.questions.length} 道 ${formatQuestionWithProgress(nextQ, state)}`,
    '',
    '还记得解法吗？回复 记得 / 不记得',
  ].join('\n');
}

function markMastered(id) {
  if (!fs.existsSync(WQ_PATH)) return;
  const questions = loadQuestions();
  const q = questions.find(q => q.id === id);
  if (q) q.status = '已掌握';
  saveJson(WQ_PATH, questions);
}

// ─── CLI 入口（cron 直接运行） ────────────────────────────────

if (require.main === module) {
  const msg = buildReminderMessage();
  console.log(msg);
}

module.exports = { buildReminderMessage, handleReviewReply, ensureStates, pickDueQuestions };
