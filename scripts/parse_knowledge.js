/**
 * parse_knowledge.js
 * 解析4个markdown知识框架文件为层级知识树JSON。
 *
 * 输出：
 *   data/knowledge_tree.json — 完整树结构
 *   data/knowledge_flat.json — 扁平索引（方便快速查找节点）
 *
 * 路径ID规则：
 *   每层取 title 前4个汉字（去标点）的拼音首字母，用 . 连接
 *   如：判断推理 > 图形推理 > 位置规律 > 平移
 *     → panduan-tuili.tuixing-tuili.weizhi-guilv.pingyi
 */

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const DATA_DIR = getDataDir();
const SRC_DIR  = path.join(__dirname, '..');

const FILES = [
  '言语理解.md',
  '判断推理.md',
  '资料分析.md',
  '数量关系.md',
];

// ─── 工具函数 ─────────────────────────────────────────────────

/** 提取字符串中的中文字符（用于生成ID） */
function extractChinese(s) {
  return (s || '').replace(/[^\u4e00-\u9fa5]/g, '');
}

/** 生成简短的路径ID */
function makeNodeId(title) {
  if (!title) return 'unknown';
  const cn = extractChinese(title);
  if (!cn) return title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20).toLowerCase();
  // 取前8个汉字作为ID
  return cn.slice(0, 8) || cn;
}

/** 清理标题（去掉序号前缀） */
function cleanTitle(title) {
  return (title || '').replace(/^[一二三四五六七八九十]+[、，.]?\s*/, '').trim();
}

// ─── Markdown 解析 ───────────────────────────────────────────

/**
 * 解析单个markdown文件为树节点
 */
function parseMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const root = {
    name: '',
    level: 0,
    content_lines: [],
    images: [],
    children: [],
    question_ids: [],
  };

  // 用栈追踪当前路径
  let stack = [{ node: root, level: 0 }];
  let currentContent = [];
  let currentImages = [];

  function flushContent(targetNode) {
    if (currentContent.length > 0 || currentImages.length > 0) {
      targetNode.content_lines = currentContent.filter(l => l.trim());
      targetNode.images = [...currentImages];
      currentContent = [];
      currentImages = [];
    }
  }

  for (const line of lines) {
    const hMatch = line.match(/^(#{1,5})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const rawTitle = hMatch[2].trim();

      // 先flush上一段内容到当前节点
      const parent = stack[stack.length - 1].node;
      flushContent(parent);

      // 回溯到合适的层级
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const newNode = {
        name: rawTitle,
        clean_name: cleanTitle(rawTitle),
        level,
        id: makeNodeId(rawTitle),
        content_lines: [],
        images: [],
        children: [],
        question_ids: [],
      };

      const currentParent = stack[stack.length - 1].node;
      currentParent.children.push(newNode);

      stack.push({ node: newNode, level });
      continue;
    }

    // 图片行
    const imgMatch = line.match(/<img\s+src="([^"]+)"[^>]*>/);
    if (imgMatch) {
      currentImages.push({
        src: imgMatch[1],
        original_line: line.trim(),
      });
      continue;
    }

    // 普通内容行（跳过空行但记录有意义的内容）
    if (line.trim()) {
      currentContent.push(line);
    }
  }

  // flush 最后一段
  if (stack.length > 0) {
    flushContent(stack[stack.length - 1].node);
  }

  return root.children[0] || root;  // 返回 # 标题下的第一个节点
}

// ─── 树展开为扁平索引 ────────────────────────────────────────

/**
 * 将树展开为扁平节点列表，每个节点带完整路径
 */
function flattenTree(tree, moduleName) {
  const flat = [];
  const pathMap = {};  // path_id → node

  function walk(node, ancestors) {
    const ancestorNames = ancestors.map(a => a.name);
    const pathStr = [...ancestorNames, node.clean_name || node.name].join(' > ');
    const pathId  = [...ancestors.map(a => a.id), node.id].filter(Boolean).join('.');

    // 为每个非根节点创建扁平记录
    if (node.level > 0) {
      const flatNode = {
        path:        pathStr,
        path_id:     pathId,
        name:        node.clean_name || node.name,
        level:       node.level,
        module:      moduleName,
        content:     node.content_lines.join('\n'),
        images:      node.images,
        question_ids: node.question_ids || [],
        children_count: node.children?.length || 0,
      };
      flat.push(flatNode);
      pathMap[pathId] = flatNode;
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child, [...ancestors, { name: node.clean_name || node.name, id: node.id }]);
      }
    }
  }

  walk(tree, []);
  return { flat, pathMap };
}

// ─── 生成统计摘要 ─────────────────────────────────────────────

function generateStats(trees) {
  const stats = {};
  for (const [modName, tree] of Object.entries(trees)) {
    const { flat } = flattenTree(tree, modName);
    const levels = {};
    flat.forEach(n => {
      levels[n.level] = (levels[n.level] || 0) + 1;
    });
    stats[modName] = {
      total_nodes: flat.length,
      levels,
      max_depth: Math.max(...Object.keys(levels).map(Number)),
    };
  }
  return stats;
}

// ─── 主函数 ───────────────────────────────────────────────────

function parseAllKnowledge() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const trees = {};
  const allFlat = [];
  const allPathMap = {};

  for (const file of FILES) {
    const filePath = path.join(SRC_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[parse_knowledge] 文件不存在，跳过: ${file}`);
      continue;
    }

    console.log(`[parse_knowledge] 解析: ${file}`);
    const tree = parseMarkdownFile(filePath);
    const moduleName = tree.clean_name || tree.name;
    trees[moduleName] = tree;

    const { flat, pathMap } = flattenTree(tree, moduleName);
    allFlat.push(...flat);
    Object.assign(allPathMap, pathMap);
  }

  // 保存完整树
  const treePath = path.join(DATA_DIR, 'knowledge_tree.json');
  fs.writeFileSync(treePath, JSON.stringify(trees, null, 2), 'utf-8');
  console.log(`[parse_knowledge] 知识树已保存: ${treePath}`);

  // 保存扁平索引
  const flatPath = path.join(DATA_DIR, 'knowledge_flat.json');
  fs.writeFileSync(flatPath, JSON.stringify({
    nodes: allFlat,
    path_map: allPathMap,
    stats: generateStats(trees),
  }, null, 2), 'utf-8');
  console.log(`[parse_knowledge] 扁平索引已保存: ${flatPath}`);

  // 打印统计
  const stats = generateStats(trees);
  console.log('\n========== 解析统计 ==========');
  const totalNodes = Object.values(stats).reduce((s, m) => s + m.total_nodes, 0);
  for (const [mod, s] of Object.entries(stats)) {
    const levelInfo = Object.entries(s.levels)
      .map(([l, c]) => `L${l}:${c}`)
      .join(' ');
    console.log(`  ${mod}: ${s.total_nodes} 节点 (${levelInfo})`);
  }
  console.log(`  总计: ${totalNodes} 节点`);
  console.log('==============================\n');

  return { trees, flat: allFlat, pathMap: allPathMap, stats };
}

// ─── 加载已解析的知识树 ──────────────────────────────────────

function loadKnowledgeTree() {
  const treePath = path.join(DATA_DIR, 'knowledge_tree.json');
  if (!fs.existsSync(treePath)) return null;
  return JSON.parse(fs.readFileSync(treePath, 'utf-8'));
}

function loadKnowledgeFlat() {
  const flatPath = path.join(DATA_DIR, 'knowledge_flat.json');
  if (!fs.existsSync(flatPath)) return null;
  return JSON.parse(fs.readFileSync(flatPath, 'utf-8'));
}

// ─── CLI 入口 ─────────────────────────────────────────────────

if (require.main === module) {
  parseAllKnowledge();
}

module.exports = { parseAllKnowledge, loadKnowledgeTree, loadKnowledgeFlat, parseMarkdownFile };
