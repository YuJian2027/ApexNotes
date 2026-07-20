/**
 * ingest_wrong_question.js
 * 错题上传统一编排器
 *
 * 职责：把解析后的错题对象，经过「定位 → 确认 → 入库」完整流程。
 * 修复断点①（统一路由）和②（串联定位引擎）。
 *
 * 使用方式（agent 调用）：
 *   1. agent 解析用户输入（截图多模态 / 快捷格式 / 自然语言）
 *   2. 对每道错题调用 ingestQuestion() → 得到确认卡片
 *   3. 用 formatCard() 展示卡片给用户，用户确认或修正
 *   4. 调用 confirmAndSave() 入库 + 累加每日打卡
 *
 * 命令行测试：
 *   node ingest_wrong_question.js "判断-逻辑判断-粗心" "资料-增长率-公式不熟"
 */

const { locateQuestion } = require('./link_questions');
const { saveWrongQuestion, incrementDailyWrongCount } = require('./update_daily');


// ─────────────────────────────────────────────
// 定位编排
// ─────────────────────────────────────────────

/**
 * 对单道错题执行定位，返回确认卡片（不入库）
 * @param {object} question  解析后的错题对象（来自 parse_input.js）
 *   需包含: { module, subtype, error_reason, keywords, question_text, date, source }
 * @param {object} opts      { index, total } 当前第几道/共几道
 * @returns {object} 确认卡片
 */
function ingestQuestion(question, opts = {}) {
  const { index, total } = opts;

  // 调用定位引擎
  const located = locateQuestion({
    module:        question.module,
    subtype:       question.subtype,
    keywords:      question.keywords || [],
    question_text: question.question_text || '',
  });

  // 定位失败（知识框架未解析等）
  if (located.error) {
    return {
      index, total,
      module:                question.module,
      subtype:               question.subtype,
      error_reason:          question.error_reason,
      question_text:         question.question_text,
      keywords:              question.keywords || [],
      knowledge_path:        null,
      knowledge_confidence:  'none',
      knowledge_node_id:     null,
      locate_error:          located.error,
      needs_confirm:         '定位失败：' + located.error,
    };
  }

  return {
    index, total,
    module:                question.module,
    subtype:               question.subtype,
    error_reason:          question.error_reason,
    question_text:         question.question_text,
    keywords:              question.keywords || [],
    selected_option:       question.selected_option || null,
    correct_option:        question.correct_option || null,
    knowledge_path:        located.path,
    knowledge_confidence:  located.confidence.level,   // high / medium / low / none
    knowledge_node_id:     located.path_id,
    knowledge_score:       located.score,
    needs_confirm:         null,
  };
}

/**
 * 批量定位，返回确认卡片数组
 * @param {object[]} questions  解析后的错题对象数组
 * @returns {object[]} 确认卡片数组
 */
function ingestBatch(questions) {
  const total = questions.length;
  return questions.map((q, i) => ingestQuestion(q, { index: i + 1, total }));
}


// ─────────────────────────────────────────────
// 确认入库
// ─────────────────────────────────────────────

/**
 * 用户确认后入库：写 wrong_questions.json + 累加每日打卡
 * @param {object} confirmedCard  用户确认后的卡片（可能修正过 module/subtype/error_reason 等字段）
 * @returns {object} { saved: true, id, total_questions }
 */
function confirmAndSave(confirmedCard) {
  // 选项必填守卫：selected_option / correct_option 必须至少补齐其一（协议要求双填）
  if (!confirmedCard.selected_option && !confirmedCard.correct_option) {
    return {
      saved:  false,
      blocked: true,
      reason: '选项必填：请先补齐 selected_option（你选的）/ correct_option（正确的）再入库',
    };
  }

  const date = confirmedCard.date || new Date().toISOString().slice(0, 10);

  // 构造入库对象（字段标准化）
  const question = {
    date:                 date,
    source:               confirmedCard.source || 'ingest',
    module:               confirmedCard.module,
    subtype:              confirmedCard.subtype,
    error_reason:         confirmedCard.error_reason,
    keywords:             confirmedCard.keywords || [],
    question_text:        confirmedCard.question_text || '',
    selected_option:      confirmedCard.selected_option || null,
    correct_option:       confirmedCard.correct_option || null,
    answer:               confirmedCard.correct_option || confirmedCard.answer || null,
    status:               confirmedCard.status || '待二刷',
    knowledge_path:       confirmedCard.knowledge_path || null,
    knowledge_confidence: confirmedCard.knowledge_confidence || 'none',
    knowledge_node_id:    confirmedCard.knowledge_node_id || null,
  };

  // 保留图片字段（截图场景）
  if (confirmedCard.raw_image_b64) question.raw_image_b64 = confirmedCard.raw_image_b64;
  if (confirmedCard.image_path)    question.image_path    = confirmedCard.image_path;

  // 入库 wrong_questions.json
  const updated = saveWrongQuestion(question);
  const savedId = updated[updated.length - 1].id;

  // 累加每日打卡（模块错题数 +1，不覆盖）
  incrementDailyWrongCount(date, question.module, question.error_reason);

  return { saved: true, id: savedId, total_questions: updated.length };
}


// ─────────────────────────────────────────────
// 卡片格式化（供 agent 展示给用户）
// ─────────────────────────────────────────────

/**
 * 将确认卡片格式化为可读文本
 */
function formatCard(card) {
  // confidence 等级翻译
  const CONF_MAP = { high: '精确匹配', medium: '部分匹配', low: '弱匹配', none: '未匹配' };
  const confLabel = CONF_MAP[card.knowledge_confidence] || card.knowledge_confidence || '未匹配';

  const lines = [
    `【第${card.index}/${card.total}道】`,
  ];

  // ── 核心信息：归类定位（最需要核对） ──
  if (card.knowledge_path) {
    lines.push(`归类 → ${card.knowledge_path}（${confLabel}）`);
  } else if (card.locate_error) {
    lines.push(`归类 → 定位失败（${card.locate_error}）`);
  } else {
    lines.push(`归类 → 未匹配`);
  }

  // 关键词（定位引擎的输入，核对归类是否合理的关键依据）
  if (card.keywords && card.keywords.length > 0) {
    lines.push(`关键词：${card.keywords.join('、')}`);
  }

  // ── 辅助信息：错因 ──
  lines.push(`错因：${card.error_reason}`);

  // ── 选项信息（必填项）：你选的 vs 正确的 ──
  const sel = card.selected_option ? String(card.selected_option).toUpperCase() : null;
  const cor = card.correct_option ? String(card.correct_option).toUpperCase() : null;
  if (sel || cor) {
    const optParts = [];
    if (sel) optParts.push(`你选 ${sel} ❌`);
    if (cor) optParts.push(`正确 ${cor} ✅`);
    lines.push(`选项：${optParts.join(' / ')}`);
  } else {
    // 未识别也必须提示用户补齐（必填项）
    lines.push(`选项：⚠️ 未识别，必填 → 请补充（格式：你选A 正确C）`);
  }

  // 题干预览（判断归类是否合理的参考）
  if (card.question_text && card.question_text.length > 5) {
    const preview = card.question_text.slice(0, 80);
    lines.push(`题干：${preview}${card.question_text.length > 80 ? '...' : ''}`);
  }

  lines.push('────────────────');
  lines.push('回复"对"确认 / "归类改成XX"修正归类 / "错因改成XX"修正错因 / "你选A正确C"补选项 / "跳过"丢弃');

  return lines.join('\n');
}


// ─────────────────────────────────────────────
// 命令行测试入口
// ─────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法: node ingest_wrong_question.js "判断-逻辑判断-粗心" "资料-增长率-公式不熟"');
    console.log('      每个参数是一道快捷格式错题，会定位并展示确认卡片（不入库）');
    process.exit(0);
  }

  // 内联快捷格式解析（避免循环依赖 parse_input 的导出问题）
  const fs   = require('fs');
  const path = require('path');
  const MODULE_MAP = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../assets/module_map.json'), 'utf-8')
  );
  function normMod(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    for (const [standard, aliases] of Object.entries(MODULE_MAP.aliases)) {
      if (aliases.some(a => lower.includes(a.toLowerCase()))) return standard;
    }
    return null;
  }

  const questions = args.map(arg => {
    const parts = arg.split(/[-—·\/]/);
    return {
      date:          new Date().toISOString().slice(0, 10),
      source:        'quick',
      module:        normMod(parts[0]) || parts[0],
      subtype:       parts[1]?.trim() || '',
      error_reason:  parts[2]?.trim() || '未说明',
      keywords:      [],
      question_text: arg,
      status:        '待二刷',
    };
  });

  const cards = ingestBatch(questions);
  cards.forEach(card => {
    console.log(formatCard(card));
    console.log();
  });
}

module.exports = { ingestQuestion, ingestBatch, confirmAndSave, formatCard, parseOptionInput };


// ─────────────────────────────────────────────
// 选项解析（用户回复补填「你选X 正确Y」）
// ─────────────────────────────────────────────

/**
 * 从用户确认阶段的回复文本中解析选项信息。
 * 支持的常见写法（大小写不敏感，X/Y ∈ A-D）：
 *   - "你选A 正确C" / "我选B对C" / "选A正确C"
 *   - "选A" "正确C" "你选B" "正确答案C" 单独出现也可
 * @param {string} text  用户回复
 * @returns {object|null} { selected_option, correct_option }（缺失项为 null）；无匹配返回 null
 */
function parseOptionInput(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();

  // 你选 / 我选 / 选 后跟 A-D
  const selMatch = t.match(/(?:你选|我选|选)\s*([abcd])/);
  // 正确 / 答案 / 对 后跟 A-D（允许"是/为"等字）
  const corMatch = t.match(/(?:正确|答案|对)\s*(?:是|为)?\s*([abcd])/);

  if (!selMatch && !corMatch) return null;
  return {
    selected_option: selMatch ? selMatch[1].toUpperCase() : null,
    correct_option:  corMatch ? corMatch[1].toUpperCase() : null,
  };
}
