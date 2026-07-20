/**
 * update_daily.js
 * 将解析后的备考数据写入每日记录，并更新统计缓存。
 */

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');
const { initState } = require('./eb_schedule');

const DATA_DIR = getDataDir();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
/**
 * 备份 wrong_questions.json，保留最近10个备份，自动轮转旧备份。
 */
function backupWrongQuestions(wqPath) {
  if (!fs.existsSync(wqPath)) return;

  const backupDir = path.join(path.dirname(wqPath), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest   = path.join(backupDir, `wrong_questions.${ts}.json`);
  fs.copyFileSync(wqPath, dest);

  // 保留最近 5 个，删除更早的（错题含 base64 后单文件体积增大，减少轮换避免磁盘膨胀）
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('wrong_questions.') && f.endsWith('.json'))
    .sort()
    .reverse();

  backups.slice(5).forEach(f => {
    try { fs.unlinkSync(path.join(backupDir, f)); } catch (_) {}
  });
}



/**
 * 写入每日记录
 * @param {ParsedInput} parsed  来自 parse_input.js 的解析结果
 * @param {string} note         可选备注
 */
function updateDailyRecord(parsed, note = '') {
  ensureDir(path.join(DATA_DIR, 'daily'));

  const filePath = path.join(DATA_DIR, 'daily', `${parsed.date}.json`);

  // 如果当天已有记录，合并而非覆盖
  let existing = {};
  if (fs.existsSync(filePath)) {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  const record = {
    date: parsed.date,
    skipped: parsed.skip_today,
    modules: {},
    ...existing,
    mood: parsed.mood,
    note: note || parsed.raw_message.slice(0, 100),
    updated_at: new Date().toISOString(),
  };

  // 合并模块数据
  for (const [mod, data] of Object.entries(parsed.parsed_modules)) {
    record.modules[mod] = {
      ...record.modules[mod],
      ...data,
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  console.log(`[apexnotes] 每日记录已写入: ${filePath}`);

  // 更新统计缓存
  updateStatsCache(parsed.date, record);

  return record;
}

/**
 * 更新统计缓存（连续打卡天数、模块准确率）
 */
function updateStatsCache(today, todayRecord) {
  const cachePath = path.join(DATA_DIR, 'stats_cache.json');

  let cache = {
    last_updated: today,
    total_days_studied: 0,
    streak: 0,
    module_accuracy: {},
  };
  if (fs.existsSync(cachePath)) {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }

  // 统计连续打卡
  if (!todayRecord.skipped) {
    cache.total_days_studied = (cache.total_days_studied || 0) + 1;

    // 简单连续天数计算：如果昨天有记录则 +1，否则重置为 1
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yPath = path.join(DATA_DIR, 'daily', `${yesterday.toISOString().slice(0,10)}.json`);
    if (fs.existsSync(yPath)) {
      cache.streak = (cache.streak || 0) + 1;
    } else {
      cache.streak = 1;
    }
  }

  // 更新模块准确率（7日滚动平均）
  const last7 = getLast7Days(today);
  const moduleStats = {};

  for (const dateStr of last7) {
    const p = path.join(DATA_DIR, 'daily', `${dateStr}.json`);
    if (!fs.existsSync(p)) continue;
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    for (const [mod, info] of Object.entries(d.modules || {})) {
      if (!moduleStats[mod]) moduleStats[mod] = { wrong: 0, total: 0 };
      if (info.wrong != null) {
        moduleStats[mod].wrong += info.wrong;
        // 用标准题数作为 total 估算（如没有精确 total）
        const DEFAULT_TOTALS = { '言语理解': 40, '数量关系': 15, '判断推理': 40, '资料分析': 20 };
        moduleStats[mod].total += info.total || DEFAULT_TOTALS[mod] || 20;
      }
    }
  }

  cache.module_accuracy = {};
  for (const [mod, s] of Object.entries(moduleStats)) {
    if (s.total > 0) {
      cache.module_accuracy[mod] = parseFloat(((s.total - s.wrong) / s.total).toFixed(2));
    }
  }

  // 找出弱项（准确率 < 0.70）
  cache.weak_modules = Object.entries(cache.module_accuracy)
    .filter(([, acc]) => acc < 0.70)
    .sort(([, a], [, b]) => a - b)
    .map(([mod]) => mod);

  cache.last_updated = today;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  return cache;
}

function getLast7Days(today) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * 读取统计缓存（供回复生成使用）
 */
function readStatsCache() {
  const cachePath = path.join(DATA_DIR, 'stats_cache.json');
  if (!fs.existsSync(cachePath)) return null;
  return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
}


/**
 * 追加一条错题到 wrong_questions.json，写入前自动备份。
 * @param {object} question  错题对象（来自 parse_input.js 的识别结果）
 * @returns {object[]} 更新后的错题列表
 */
function saveWrongQuestion(question) {
  const wqPath = path.join(DATA_DIR, 'wrong_questions.json');
  ensureDir(DATA_DIR);

  // 备份（每次写入前）
  backupWrongQuestions(wqPath);

  let questions = [];
  if (fs.existsSync(wqPath)) {
    try { questions = JSON.parse(fs.readFileSync(wqPath, 'utf-8')); }
    catch (_) { questions = []; }
  }

  // 生成唯一 id
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  questions.push({ id, ...question });

  // 为新入库的「待复习」题写入遗忘曲线初始计划（学后第 1 天到期）。
  // 存量旧题的错峰初始化在 review_reminder.js 的 ensureStates() 里完成，这里不处理。
  try {
    if (question.status !== '已掌握') {
      const rsPath = path.join(DATA_DIR, 'review_state.json');
      let rs = {};
      if (fs.existsSync(rsPath)) rs = JSON.parse(fs.readFileSync(rsPath, 'utf-8'));
      if (!rs[id]) {
        rs[id] = initState(id, question.date);
        fs.writeFileSync(rsPath, JSON.stringify(rs, null, 2), 'utf-8');
      }
    }
  } catch (_) { /* 复习计划写入失败不影响错题入库 */ }

  fs.writeFileSync(wqPath, JSON.stringify(questions, null, 2), 'utf-8');
  console.log(`[apexnotes] 错题已保存，当前共 ${questions.length} 条`);
  return questions;
}

/**
 * 更新某条错题的状态（待二刷 ↔ 已掌握）。
 */
function updateWrongQuestionStatus(id, status) {
  const wqPath = path.join(DATA_DIR, 'wrong_questions.json');
  if (!fs.existsSync(wqPath)) return;

  backupWrongQuestions(wqPath);
  const questions = JSON.parse(fs.readFileSync(wqPath, 'utf-8'));
  const q = questions.find(q => q.id === id);
  if (q) q.status = status;
  fs.writeFileSync(wqPath, JSON.stringify(questions, null, 2), 'utf-8');
}

/**
 * 入库一道错题时，累加每日打卡的模块错题计数。
 * 与 updateDailyRecord 不同，这里是「+1」累加而非覆盖，
 * 适用于 ingest 编排器逐道入库的场景（避免覆盖通道C的模块级打卡数据）。
 *
 * @param {string} date         日期 YYYY-MM-DD
 * @param {string} module       模块名（言语理解/判断推理/资料分析/数量关系）
 * @param {string} errorReason  错因
 * @returns {object} 更新后的每日记录
 */
function incrementDailyWrongCount(date, module, errorReason) {
  ensureDir(path.join(DATA_DIR, 'daily'));
  const filePath = path.join(DATA_DIR, 'daily', `${date}.json`);

  let record = {};
  if (fs.existsSync(filePath)) {
    record = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  record.date      = date;
  record.skipped   = false;
  if (!record.modules) record.modules = {};
  if (!record.modules[module]) record.modules[module] = { wrong: 0, total: null };
  record.modules[module].wrong        = (record.modules[module].wrong || 0) + 1;
  record.modules[module].error_reason = errorReason;
  record.mood       = record.mood || '中性';
  record.updated_at = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  // 更新统计缓存
  updateStatsCache(date, record);

  return record;
}

module.exports = { updateDailyRecord, readStatsCache, saveWrongQuestion, updateWrongQuestionStatus, incrementDailyWrongCount };
