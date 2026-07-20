/**
 * eb_schedule.js
 * 艾宾浩斯遗忘曲线复习调度引擎（纯函数，无副作用）
 *
 * 设计：
 *   - 经典记忆周期（天）已过滤亚日级间隔（5分钟/30分钟/12小时），保留日级间隔：
 *       第1次复习 = 学后 1 天，之后按曲线拉长：1→2→4→7→15→30→60→120 天
 *   - 走完整个周期（8 次）即视为「已掌握」，不再安排复习
 *   - 中途「忘了」→ 间隔重置回第 1 天，明天再复习（保守策略，避免夹生）
 *
 * 该模块被 review_reminder.js（抽题/处理回复）与 update_daily.js（新题初始化）共用，
 * 不依赖任何项目文件，避免循环引用。
 */

// 复习间隔（天）——艾宾浩斯记忆周期的日级近似
const EB_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120];

// 存量（迁移）题目错峰窗口：把老题的首个到期日分散到未来 STAGGER_DAYS 天内，
// 避免一次性涌入几百道题。新题不享受错峰（学后第 1 天即到期）。
const STAGGER_DAYS = 30;

// ─── 日期工具（全部按本地时区，避免 UTC 跨日 off-by-one） ───────────

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return fmt(new Date());
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return fmt(dt);
}

// b - a（天），b 较晚为正
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

// 稳定的字符串哈希（用于错峰偏移，保证同一题每次结果一致）
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ─── 状态构造 ─────────────────────────────────────────────────

/**
 * 新题（刚学会）的初始复习状态：学后第 1 天首次到期。
 * @param {string} id          题目 id
 * @param {string} learnDate   学会日期 YYYY-MM-DD（默认今天）
 */
function initState(id, learnDate) {
  const learn = learnDate || todayStr();
  return {
    id,
    stage: 0,                       // 当前所处的间隔索引（= 已成功复习次数）
    last_reviewed: null,            // 上次复习日期
    next_due: addDays(learn, EB_INTERVALS[0]),
    learn_date: learn,
    lapses: 0,                      // 遗忘（「忘了」）次数
    reviews: 0,                     // 总复习次数
    graduated: false,               // 是否走完整个周期
  };
}

/**
 * 存量（迁移）题目的初始复习状态：错峰，避免一次性涌入。
 * 首个到期日 = 今天 + 1~STAGGER_DAYS 天（按 id 哈希分散）。
 */
function initStateStaggered(id, learnDate) {
  const s = initState(id, learnDate);
  const offset = 1 + (hashStr(id) % STAGGER_DAYS);
  s.next_due = addDays(todayStr(), offset);
  return s;
}

// ─── 核心：处理一次复习反馈 ───────────────────────────────────

/**
 * 根据「记得 / 忘了」更新状态（就地修改并返回）。
 * @param {object} state         题目复习状态
 * @param {boolean} remembered   true=记得，false=忘了
 * @returns {object} 更新后的 state
 */
function processReview(state, remembered) {
  state.reviews += 1;
  state.last_reviewed = todayStr();

  if (remembered) {
    state.stage += 1;
    if (state.stage >= EB_INTERVALS.length) {
      // 走完整个遗忘曲线 → 毕业，不再安排
      state.graduated = true;
      state.next_due = null;
    } else {
      state.next_due = addDays(todayStr(), EB_INTERVALS[state.stage]);
    }
  } else {
    // 遗忘：间隔重置回第 1 天，明天再复习
    state.lapses += 1;
    state.stage = 0;
    state.graduated = false;
    state.next_due = addDays(todayStr(), EB_INTERVALS[0]);
  }
  return state;
}

// ─── 查询 ─────────────────────────────────────────────────────

/**
 * 是否到期（含逾期且未毕业）。
 */
function isDue(state, today) {
  today = today || todayStr();
  return !!(state && !state.graduated && state.next_due != null && state.next_due <= today);
}

/**
 * 下次复习间隔（天）；已毕业返回 null。
 */
function nextIntervalDays(state) {
  if (!state || state.graduated || state.stage >= EB_INTERVALS.length) return null;
  return EB_INTERVALS[state.stage];
}

module.exports = {
  EB_INTERVALS,
  STAGGER_DAYS,
  todayStr,
  addDays,
  daysBetween,
  hashStr,
  initState,
  initStateStaggered,
  processReview,
  isDue,
  nextIntervalDays,
};
