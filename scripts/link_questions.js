/**
 * link_questions.js
 * 自动定位引擎：将错题匹配到知识框架中的最佳节点。
 *
 * 4级匹配策略（逐级降级）：
 *   L1 模块匹配     — 根据 question.module 筛选候选节点
 *   L2 题型匹配     — 用 subtype 匹配节点名称/路径
 *   L3 关键词匹配   — 用 keywords 匹配节点内容
 *   L4 内容匹配     — 用 question_text 做全文匹配
 *
 * 用法：
 *   const { locateQuestion } = require('./link_questions');
 *   const result = locateQuestion(questionObject);
 *   // → { path, path_id, node, confidence, level }
 */

const { loadKnowledgeFlat } = require('./parse_knowledge');

// ─── 模块名映射（标准化） ────────────────────────────────────

const MODULE_NORMALIZE = {
  '言语理解':       '言语理解',
  '言语理解与表达':  '言语理解',
  '言语':           '言语理解',
  '数量关系':       '数量关系',
  '数量':           '数量关系',
  '判断推理':       '判断推理',
  '判断':           '判断推理',
  '资料分析':       '资料分析',
  '资料':           '资料分析',
};

// ─── 题型到知识节点的关键词映射 ──────────────────────────────

const SUBTYPE_MAP = {
  // 言语理解
  '言语-主旨概括':       ['中心理解', '主旨概括', '行文脉络'],
  '言语-语句填空':       ['语句填空', '语句表达'],
  '言语-语句排序':       ['语句排序'],
  '言语-细节判断':       ['细节理解', '细节判断'],
  '言语-下文推断':       ['下文推断'],
  '言语-逻辑填空':       ['逻辑填空', '实词填空', '成语填空'],
  // 判断推理
  '图形推理':            ['图形推理', '位置规律', '样式规律', '属性规律'],
  '定义判断':            ['定义判断'],
  '类比推理':            ['类比推理'],
  '逻辑判断':            ['逻辑判断', '翻译推理', '加强削弱', '真假推理'],
  // 数量关系
  '数学运算-工程':        ['工程问题', '效率', '天完成'],
  '数学运算-行程':        ['行程问题', '速度', '相遇'],
  '数学运算-排列组合':     ['排列组合', '概率'],
  '数学运算-方程':        ['方程法', '不定方程'],
  '数学运算-浓度':        ['浓度', '盐水', '十字相乘'],
  '数学运算-整除':        ['整除', '余数', '倍数特性'],
  '数学运算-数列':        ['等差数列'],
  // 资料分析
  '资料分析-增长率':       ['增长率', '增长量', '同比', '环比'],
  '资料分析-比重':         ['比重', '占比', '比值'],
  '资料分析-倍数':         ['倍数', '翻番'],
  '资料分析-平均数':       ['平均'],
  '资料分析-进出口':       ['进出口'],
};

// ─── 匹配引擎 ────────────────────────────────────────────────

/**
 * L1: 模块名匹配 — 筛选出指定模块的所有节点
 */
function matchByModule(moduleName, flatData) {
  const normalized = MODULE_NORMALIZE[moduleName] || moduleName;
  return flatData.nodes.filter(n => n.module === normalized);
}

/**
 * L2: 题型/子类型匹配 — 用 subtype 匹配节点名或路径
 */
function matchBySubtype(subtype, candidates) {
  if (!subtype || subtype === '未识别') return candidates;

  const keywords = SUBTYPE_MAP[subtype] || [];
  if (keywords.length === 0) {
    // 没有映射表，直接用 subtype 文字匹配
    keywords.push(subtype);
  }

  const scored = candidates.map(node => {
    let score = 0;
    const nameAndPath = (node.name + ' ' + node.path).toLowerCase();

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (node.name.includes(kw) || node.path.includes(kw)) {
        score += 3;  // 名称精确匹配
      } else if (nameAndPath.includes(kwLower)) {
        score += 1;  // 模糊匹配
      }
    }

    return { node, score };
  });

  // 返回得分 > 0 的，按分数降序
  const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  return matched.length > 0 ? matched : scored.map(s => ({ ...s, score: 0 }));
}

/**
 * L3: 关键词匹配 — 用 question.keywords 匹配节点内容
 */
function matchByKeywords(keywords, candidates) {
  if (!keywords || keywords.length === 0) return candidates;

  return candidates.map(({ node, score }) => {
    let kwScore = 0;
    const content = (node.content || '').toLowerCase();
    const name    = (node.name || '').toLowerCase();
    const path    = (node.path || '').toLowerCase();

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      // 在节点名称或路径中匹配 → 高分
      if (name.includes(kwLower) || path.includes(kwLower)) {
        kwScore += 5;
      }
      // 在内容中匹配 → 中分
      else if (content.includes(kwLower)) {
        kwScore += 2;
      }
    }

    return { node, score: score + kwScore };
  });
}

/**
 * L4: 内容语义匹配 — 用 question_text 做全文匹配
 */
function matchByContent(questionText, candidates) {
  if (!questionText || questionText.length < 3) return candidates;

  const textLower = questionText.toLowerCase();
  // 提取问题中的关键中文词汇（2-5字连续片段）
  const fragments = [];
  for (let i = 0; i < textLower.length - 1; i++) {
    for (let len = 2; len <= 5 && i + len <= textLower.length; len++) {
      const frag = textLower.slice(i, i + len);
      if (/[\u4e00-\u9fa5]+/.test(frag) && !/的|了|是|在|和|与|或|也|就|都|很|不|这|那/.test(frag)) {
        fragments.push(frag);
      }
    }
  }

  return candidates.map(({ node, score }) => {
    let contentScore = 0;
    const content = (node.content || '').toLowerCase();
    const name    = (node.name || '').toLowerCase();

    for (const frag of fragments) {
      // 在节点名称中命中
      if (name.includes(frag)) {
        contentScore += 2;
      }
      // 在内容中命中
      else if (content.includes(frag)) {
        contentScore += 0.5;
      }
    }

    return { node, score: score + contentScore };
  });
}

/**
 * 计算匹配置信度
 */
function calcConfidence(bestScore, totalCandidates) {
  if (bestScore === 0 || totalCandidates === 0) return { level: 'none', confidence: 0 };
  if (bestScore >= 8)  return { level: 'high',     confidence: 0.9, desc: '关键词/题型精确命中' };
  if (bestScore >= 5)  return { level: 'medium',   confidence: 0.7, desc: '关键词部分命中' };
  if (bestScore >= 2)  return { level: 'low',      confidence: 0.5, desc: '内容模糊匹配' };
  return { level: 'fallback', confidence: 0.3, desc: '仅模块匹配，未定位到具体节点' };
}

// ─── 主入口 ───────────────────────────────────────────────────

/**
 * 将一道错题定位到知识框架节点
 * @param {object} question — 错题对象，需含 module, subtype, keywords, question_text
 * @param {object} flatData  — knowledge_flat.json 的内容（可选，不传则自动加载）
 * @returns {object}
 */
function locateQuestion(question, flatData) {
  const flat = flatData || loadKnowledgeFlat();
  if (!flat || !flat.nodes) {
    return { error: '知识框架未解析，请先运行 parse_knowledge.js' };
  }

  // L1: 模块筛选
  let candidates = matchByModule(question.module, flat);
  if (candidates.length === 0) {
    return {
      path:     question.module || '未知',
      path_id:  'unknown',
      node:     null,
      confidence: { level: 'none', confidence: 0, desc: '未找到匹配模块' },
    };
  }

  // L2: 题型匹配
  const subtypeScored = matchBySubtype(question.subtype, candidates);

  // L3: 关键词匹配
  const keywordScored = matchByKeywords(question.keywords, subtypeScored);

  // L4: 内容匹配
  const contentScored = matchByContent(question.question_text, keywordScored);

  // 取最高分
  contentScored.sort((a, b) => b.score - a.score);
  const best = contentScored[0];
  const confidence = calcConfidence(best.score, candidates.length);

  return {
    path:       best.node.path,
    path_id:    best.node.path_id,
    node:       best.node,
    score:      best.score,
    confidence,
  };
}

/**
 * 批量定位 — 返回每道题的定位结果
 */
function locateAll(questions, flatData) {
  const flat = flatData || loadKnowledgeFlat();
  return questions.map(q => ({
    question_id: q.id,
    question:    q,
    ...locateQuestion(q, flat),
  }));
}

/**
 * 更新知识树中的 question_ids（将错题挂载到节点）
 */
function mountQuestions(questions, flatData) {
  const flat = flatData || loadKnowledgeFlat();
  if (!flat) return { error: '知识框架未解析' };

  const results = locateAll(questions, flat);
  const updatedNodes = {};

  for (const result of results) {
    if (result.path_id && result.path_id !== 'unknown') {
      const node = flat.path_map[result.path_id];
      if (node) {
        if (!node.question_ids.includes(result.question_id)) {
          node.question_ids.push(result.question_id);
        }
        updatedNodes[result.path_id] = node;
      }
    }
  }

  return { results, updated_nodes: updatedNodes };
}

// ─── 根据知识路径查找节点 ─────────────────────────────────────

/**
 * 根据知识路径字符串查找节点
 * @param {string} pathStr — 如 "判断推理 > 图形推理 > 位置规律 > 平移"
 */
function findNodeByPath(pathStr, flatData) {
  const flat = flatData || loadKnowledgeFlat();
  if (!flat) return null;
  return flat.nodes.find(n => n.path === pathStr);
}

/**
 * 根据 path_id 查找节点
 */
function findNodeById(pathId, flatData) {
  const flat = flatData || loadKnowledgeFlat();
  if (!flat) return null;
  return flat.path_map[pathId] || null;
}

// ─── CLI 测试 ─────────────────────────────────────────────────

if (require.main === module) {
  const testQuestions = [
    {
      id: 'test-001',
      module: '判断推理',
      subtype: '逻辑判断',
      keywords: ['假言命题', '充分必要条件'],
      question_text: '如果甲参加，则乙不参加；只有丙参加，丁才参加。据此可以推出？',
    },
    {
      id: 'test-002',
      module: '数量关系',
      subtype: '数学运算-工程',
      keywords: ['工程问题', '效率'],
      question_text: '一项工程，甲单独做需要10天，乙单独做需要15天，两人合作需要多少天？',
    },
    {
      id: 'test-003',
      module: '资料分析',
      subtype: '资料分析-增长率',
      keywords: ['增长率', '同比'],
      question_text: '2020年某省GDP为1000亿元，2021年为1150亿元，求同比增长率。',
    },
    {
      id: 'test-004',
      module: '言语理解',
      subtype: '言语-主旨概括',
      keywords: ['主旨概括', '中心句'],
      question_text: '这段文字的主要观点是什么？作者通过对比分析，指出当前教育模式存在的问题。',
    },
  ];

  console.log('========== 自动定位测试 ==========\n');
  const results = locateAll(testQuestions);

  for (const r of results) {
    console.log(`题目: ${r.question.question_text.slice(0, 50)}...`);
    console.log(`  定位 → ${r.path}`);
    console.log(`  分数: ${r.score} | 置信度: ${r.confidence.level} (${r.confidence.desc})`);
    console.log('');
  }

  // 统计
  const levels = {};
  results.forEach(r => { levels[r.confidence.level] = (levels[r.confidence.level] || 0) + 1; });
  console.log('定位分布:', JSON.stringify(levels));
}

module.exports = {
  locateQuestion,
  locateAll,
  mountQuestions,
  findNodeByPath,
  findNodeById,
};
