/**
 * init_demo.js
 * 项目初始化脚本（install.sh 自动调用）
 *
 * 职责：建数据目录 + 初始化空错题库 + 解析知识框架
 * （已移除 demo 演示数据生成，新用户从空白状态开始上传自己的错题）
 */

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const DATA_DIR = getDataDir();
const WQ_PATH = path.join(DATA_DIR, 'wrong_questions.json');
const DAILY_DIR = path.join(DATA_DIR, 'daily');

// 建目录
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DAILY_DIR)) fs.mkdirSync(DAILY_DIR, { recursive: true });

// 初始化空 wrong_questions.json（如不存在）
if (!fs.existsSync(WQ_PATH)) {
  fs.writeFileSync(WQ_PATH, '[]', 'utf-8');
  console.log(`[init] 已初始化空错题库 → ${WQ_PATH}`);
} else {
  const existing = JSON.parse(fs.readFileSync(WQ_PATH, 'utf-8'));
  console.log(`[init] 错题库已存在，跳过初始化（${existing.length} 条）`);
}

// 解析知识框架（建知识树，后续上传错题时定位用）
try {
  const { parseAllKnowledge } = require('./parse_knowledge');
  console.log('[init] 解析知识框架...');
  parseAllKnowledge();
  console.log('[init] 知识框架解析完成');
} catch (e) {
  console.warn('[init] 知识框架解析失败:', e.message);
}

console.log('[init] 初始化完成！可以开始上传错题了。');
