/**
 * weekly_report.js
 * 每周日晚定时触发，汇总本周备考数据 + 错因趋势。
 *
 * cron 配置：每周日 21:30
 *   schedule: "30 21 * * 0"
 *   script: scripts/weekly_report.js
 *
 * 输出周报文本到 stdout，宿主 agent / cron 捕获后推送。
 */

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');
const { buildErrorReasonTrend } = require('./error_reason_advisor');

const DATA_DIR = getDataDir();

function buildWeeklyReport() {
  const trend = buildErrorReasonTrend();

  // 统计缓存
  const cachePath = path.join(DATA_DIR, 'stats_cache.json');
  const cache = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    : {};

  // 本周 7 天每日记录
  const dailyDir = path.join(DATA_DIR, 'daily');
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    weekDays.push(d.toISOString().slice(0, 10));
  }

  let studiedDays = 0;
  let totalWrong  = 0;
  for (const day of weekDays) {
    const p = path.join(dailyDir, `${day}.json`);
    if (!fs.existsSync(p)) continue;
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!d.skipped) studiedDays++;
    for (const [, info] of Object.entries(d.modules || {})) {
      totalWrong += info.wrong || 0;
    }
  }

  const lines = [
    '=== 本周周报 ===',
    `本周学习 ${studiedDays}/7 天，累计错题 ${totalWrong} 道。`,
    `连续打卡：${cache.streak || 0} 天`,
    '',
    trend,
  ];

  // 弱项模块
  if (cache.weak_modules && cache.weak_modules.length) {
    lines.push('', `弱项模块（准确率<70%）：${cache.weak_modules.join('、')}`);
  }

  return lines.join('\n');
}

if (require.main === module) {
  console.log(buildWeeklyReport());
}

module.exports = { buildWeeklyReport };
