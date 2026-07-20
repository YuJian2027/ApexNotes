/**
 * export_knowledge_book.js
 * 生成知识本 HTML — 左侧知识树导航 + 右侧知识内容 + 挂载错题
 *
 * 用法：node scripts/export_knowledge_book.js
 * 输出：data/exports/知识本_{日期}.html
 *
 * 筛选参数：
 *   --module=判断推理    只导出某模块
 *   --with-questions     挂载错题到对应节点
 */

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const DATA_DIR = getDataDir();
const TREE_PATH    = path.join(DATA_DIR, 'knowledge_tree.json');
const FLAT_PATH    = path.join(DATA_DIR, 'knowledge_flat.json');
const WQ_PATH      = path.join(DATA_DIR, 'wrong_questions.json');

// ─── 数据加载 ─────────────────────────────────────────────────

function loadTree() {
  if (!fs.existsSync(TREE_PATH)) return null;
  return JSON.parse(fs.readFileSync(TREE_PATH, 'utf-8'));
}

function loadFlat() {
  if (!fs.existsSync(FLAT_PATH)) return null;
  return JSON.parse(fs.readFileSync(FLAT_PATH, 'utf-8'));
}

function loadWrongQuestions() {
  if (!fs.existsSync(WQ_PATH)) return [];
  return JSON.parse(fs.readFileSync(WQ_PATH, 'utf-8'));
}

// ─── HTML 生成 ────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 将中文路径哈希为短 ASCII ID（djb2，36 进制） */
function hashId(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return 'n' + Math.abs(hash).toString(36);
}

/** 渲染知识内容为 HTML */
function renderContent(contentText) {
  if (!contentText) return '';
  const lines = contentText.split('\n');
  let html = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      html += '<br>';
      continue;
    }

    // 处理不同层级缩进
    const indent = line.match(/^(\s*)/)[1].length;
    const paddingLeft = Math.min(indent * 8, 60);

    // 加粗文本
    let processed = trimmed
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    // 列表项
    if (trimmed.startsWith('- ')) {
      processed = processed.replace(/^- /, '');
      html += `<div class="content-item" style="padding-left:${paddingLeft + 20}px"><span class="bullet">•</span> ${processed}</div>`;
    } else {
      html += `<div class="content-item" style="padding-left:${paddingLeft}px">${processed}</div>`;
    }
  }

  return html;
}

/** 渲染图片 */
function renderImages(images) {
  if (!images || images.length === 0) return '';
  return images.map(img => {
    const src = escapeHtml(img.src);
    return `<div class="knowledge-image"><img src="${src}" loading="lazy" onerror="this.style.display='none'" alt="知识图解"/></div>`;
  }).join('\n');
}

/** 渲染挂载的错题 */
function renderQuestions(questions) {
  if (!questions || questions.length === 0) return '';

  const items = questions.map((q, i) => {
    const statusClass = q.status === '已掌握' ? 'mastered' : 'pending';
    const statusLabel = q.status === '已掌握' ? '已掌握' : '待二刷';
    return `
      <div class="question-card ${statusClass}">
        <div class="question-header">
          <span class="question-num">错题 ${i + 1}</span>
          <span class="question-status ${statusClass}">${statusLabel}</span>
          <span class="question-date">${escapeHtml(q.date || '')}</span>
        </div>
        <div class="question-body">
          ${q.question_text ? `<div class="question-text">${escapeHtml(q.question_text)}</div>` : ''}
          ${q.visual_description ? `<div class="question-visual">描述：${escapeHtml(q.visual_description)}</div>` : ''}
        </div>
        <div class="question-meta">
          ${q.answer ? `<span class="meta-tag answer">答案：${escapeHtml(q.answer)}</span>` : ''}
          ${q.error_reason ? `<span class="meta-tag reason">${escapeHtml(q.error_reason)}</span>` : ''}
          ${q.keywords && q.keywords.length ? `<span class="meta-tag keywords">${escapeHtml(q.keywords.join('、'))}</span>` : ''}
        </div>
      </div>`;
  }).join('\n');

  return `
    <div class="questions-section">
      <div class="section-title">📝 关联错题 (${questions.length}道)</div>
      ${items}
    </div>`;
}

/** 递归渲染树节点（parentPath 用于生成确定性唯一 ID） */
function renderTreeNode(node, moduleName, questionMap, depth = 1, parentPath = '') {
  if (!node) return '';

  const fullPath  = parentPath ? `${parentPath} > ${node.name}` : node.name;
  const nodeId    = hashId(moduleName + '|' + fullPath);
  const hasKids   = node.children && node.children.length > 0;
  const contentText = (node.content_lines || []).join('\n');
  const hasContent  = contentText.trim().length > 0 || (node.images && node.images.length > 0);

  // 查找挂载的错题
  const mountedQuestions = [];
  if (questionMap && node.question_ids && node.question_ids.length > 0) {
    for (const qid of node.question_ids) {
      if (questionMap[qid]) mountedQuestions.push(questionMap[qid]);
    }
  }
  const questionCount = mountedQuestions.length;

  const kidsHtml = hasKids
    ? `<div class="tree-children" id="children_${nodeId}">${node.children.map(c => renderTreeNode(c, moduleName, questionMap, depth + 1, fullPath)).join('\n')}</div>`
    : '';

  const expandIcon = hasKids ? `<span class="tree-toggle" onclick="toggleNode(event, '${nodeId}')">▶</span>` : `<span class="tree-spacer"></span>`;
  const qBadge = questionCount > 0 ? `<span class="q-badge">${questionCount}</span>` : '';

  return `
    <div class="tree-node depth-${depth}">
      <div class="tree-node-header ${hasContent ? 'has-content' : ''}" onclick="showContent('${nodeId}', event)" data-node-id="${nodeId}">
        ${expandIcon}
        <span class="tree-label">${escapeHtml(node.clean_name || node.name)}</span>
        ${qBadge}
      </div>
      ${kidsHtml}
      <div class="node-content" id="content_${nodeId}" style="display:none">
        <div class="kb-knowledge">${renderContent(contentText)}${renderImages(node.images)}</div>
        <div class="kb-questions">${renderQuestions(mountedQuestions)}</div>
      </div>
    </div>`;
}

function generateHtml(trees, questionMap, options = {}) {
  const { moduleFilter, withQuestions } = options;
  const modules = moduleFilter
    ? { [moduleFilter]: trees[moduleFilter] }
    : trees;

  if (!modules || Object.keys(modules).length === 0) {
    return '<p class="error">未找到知识框架数据，请先运行 parse_knowledge.js</p>';
  }

  // 渲染侧边栏树
  const treeSections = Object.entries(modules).map(([modName, rootNode]) => {
    if (!rootNode) return '';
    return `
      <div class="tree-section">
        <div class="tree-section-title" onclick="toggleSection(event, 'section_${modName}')">
          <span class="section-toggle">▼</span> ${escapeHtml(modName)}
        </div>
        <div class="tree-children" id="section_${modName}">
          ${(rootNode.children || []).map(c => renderTreeNode(c, modName, questionMap)).join('\n')}
        </div>
      </div>`;
  }).join('\n');

  // 总节点数计算
  let totalNodes = 0;
  function countNodes(tree) {
    if (!tree) return;
    if (tree.level > 0) totalNodes++;
    (tree.children || []).forEach(countNodes);
  }
  Object.values(modules).forEach(countNodes);

  const totalQuestions = questionMap ? Object.keys(questionMap).length : 0;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>行测知识本 · 上岸笔记</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #F5F3EF;
    color: #2C2416;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* ── 侧边栏 ── */
  .sidebar {
    width: 340px;
    min-width: 340px;
    background: #FFFDF7;
    border-right: 1px solid #E8E0D0;
    overflow-y: auto;
    padding: 0;
    box-shadow: 2px 0 12px rgba(0,0,0,0.04);
  }
  .sidebar-header {
    padding: 24px 20px 16px;
    border-bottom: 1px solid #E8E0D0;
    position: sticky;
    top: 0;
    background: #FFFDF7;
    z-index: 10;
  }
  .sidebar-header h1 {
    font-size: 20px;
    font-weight: 700;
    color: #B93A32;
    margin-bottom: 4px;
  }
  .sidebar-header .subtitle {
    font-size: 12px;
    color: #8C8273;
  }
  .sidebar-stats {
    display: flex;
    gap: 16px;
    padding: 8px 20px 16px;
    font-size: 12px;
    color: #8C8273;
  }

  /* ── 树结构 ── */
  .tree-section { border-bottom: 1px solid #F0EBE0; }
  .tree-section-title {
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 600;
    color: #4A3F2F;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
    background: #FAF7F0;
    transition: background 0.15s;
  }
  .tree-section-title:hover { background: #F2EDE0; }
  .section-toggle {
    font-size: 10px;
    transition: transform 0.2s;
    display: inline-block;
  }
  .section-toggle.collapsed { transform: rotate(-90deg); }

  .tree-node { position: relative; }
  .tree-node-header {
    padding: 6px 20px 6px 20px;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #5C5040;
    transition: background 0.12s;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-node-header:hover { background: #F2EDE0; }
  .tree-node-header.active { background: #EDE4D0; color: #B93A32; font-weight: 600; }

  .tree-node.depth-2 .tree-node-header { padding-left: 32px; }
  .tree-node.depth-3 .tree-node-header { padding-left: 44px; }
  .tree-node.depth-4 .tree-node-header { padding-left: 56px; }
  .tree-node.depth-5 .tree-node-header { padding-left: 68px; }

  .tree-toggle {
    font-size: 9px;
    width: 14px;
    flex-shrink: 0;
    transition: transform 0.2s;
    display: inline-block;
    text-align: center;
    color: #8C8273;
  }
  .tree-toggle.expanded { transform: rotate(90deg); }
  .tree-spacer { width: 14px; flex-shrink: 0; }

  .tree-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .q-badge {
    flex-shrink: 0;
    background: #B93A32;
    color: #FFF;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
    min-width: 18px;
    text-align: center;
  }
  .tree-children.collapsed { display: none; }

  /* ── 主内容区域（两栏容器） ── */
  .main {
    flex: 1;
    display: flex;
    overflow: hidden;
    background: #F5F3EF;
  }

  /* 左栏：知识点细节 */
  .content-left {
    flex: 1;
    overflow-y: auto;
    padding: 32px 40px;
    min-width: 0;
  }
  /* 右栏：错题整理 */
  .content-right {
    width: 380px;
    min-width: 380px;
    overflow-y: auto;
    padding: 32px 28px;
    background: #FFFDF7;
    border-left: 1px solid #E8E0D0;
  }

  .main-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #B8AD98;
    font-size: 15px;
  }
  .main-empty .icon { font-size: 48px; margin-bottom: 16px; }

  /* ── 内容面板 ── */
  .content-panel {
    max-width: 860px;
  }
  .content-breadcrumb {
    font-size: 12px;
    color: #8C8273;
    margin-bottom: 16px;
    padding: 8px 0;
    border-bottom: 1px dashed #E0D8C8;
  }
  .content-title {
    font-size: 24px;
    font-weight: 700;
    color: #2C2416;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 2px solid #B93A32;
  }

  /* 右栏空状态 */
  .empty-questions {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #B8AD98;
    font-size: 14px;
    text-align: center;
  }
  .empty-questions .icon { font-size: 36px; margin-bottom: 12px; }

  /* 右栏标题 */
  .questions-panel-title {
    font-size: 16px;
    font-weight: 700;
    color: #4A3F2F;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid #B93A32;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .questions-panel-title .q-count {
    background: #B93A32;
    color: #FFF;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 10px;
  }

  .content-item {
    font-size: 14px;
    line-height: 1.8;
    color: #4A3F2F;
    padding: 2px 0;
  }
  .content-item .bullet { color: #B93A32; margin-right: 6px; }
  .content-item strong { color: #2C2416; }
  .content-item code {
    background: #F0EBE0;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 13px;
    color: #B93A32;
  }

  .knowledge-image {
    margin: 16px 0;
    text-align: center;
  }
  .knowledge-image img {
    max-width: 100%;
    max-height: 400px;
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  /* ── 错题卡 ── */
  .questions-section {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid #E8E0D0;
  }
  .section-title {
    font-size: 16px;
    font-weight: 600;
    color: #4A3F2F;
    margin-bottom: 16px;
  }
  .question-card {
    background: #FFFDF7;
    border: 1px solid #E8E0D0;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    transition: box-shadow 0.2s;
  }
  .question-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .question-card.mastered { opacity: 0.7; border-left: 3px solid #2F7D57; }
  .question-card.pending { border-left: 3px solid #B93A32; }

  .question-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .question-num { font-size: 12px; color: #8C8273; font-weight: 600; }
  .question-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
  }
  .question-status.pending { background: #F8E8E4; color: #B93A32; }
  .question-status.mastered { background: #E6F2EB; color: #2F7D57; }
  .question-date { font-size: 11px; color: #B8AD98; margin-left: auto; }

  .question-body { margin-bottom: 10px; }
  .question-text { font-size: 14px; color: #2C2416; line-height: 1.7; }
  .question-visual { font-size: 12px; color: #6B5F4F; font-style: italic; margin-top: 6px; }

  .question-meta { display: flex; gap: 8px; flex-wrap: wrap; }
  .meta-tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: #F0EBE0;
    color: #5C5040;
  }
  .meta-tag.answer { background: #E7EEF9; color: #2D5FA1; }
  .meta-tag.reason { background: #F8E8E4; color: #B93A32; }
  .meta-tag.keywords { background: #F6EBD5; color: #B9822B; }

  .error { color: #B93A32; padding: 32px; text-align: center; }

  /* 响应式 */
  @media (max-width: 768px) {
    .sidebar { width: 100%; min-width: 0; position: fixed; z-index: 100; height: 50%; overflow-y: auto; }
    .main { padding-top: 55%; }
    body { flex-direction: column; }
  }

  /* 打印样式 */
  @media print {
    .sidebar { display: none; }
    .main { padding: 0; overflow: visible; }
    .content-panel { max-width: 100%; }
    body { display: block; overflow: visible; }
  }
</style>
</head>
<body>

<!-- 侧边栏 -->
<aside class="sidebar">
  <div class="sidebar-header">
    <h1>行测知识本</h1>
    <div class="subtitle">上岸笔记</div>
  </div>
  <div class="sidebar-stats">
    <span>📚 ${totalNodes} 知识点</span>
    ${withQuestions ? `<span>📝 ${totalQuestions} 错题</span>` : ''}
  </div>
  ${treeSections}
</aside>

<!-- 主内容（两栏） -->
<main class="main" id="main-content">
  <div class="content-left" id="panel-knowledge">
    <div class="main-empty">
      <div class="icon">📖</div>
      <div>从左侧选择一个知识点查看详情</div>
    </div>
  </div>
  <div class="content-right" id="panel-questions">
    <div class="empty-questions">
      <div class="icon">📝</div>
      <div>选择知识点后<br/>关联错题将显示在此</div>
    </div>
  </div>
</main>

<script>
  // ── 树交互 ──
  function toggleNode(event, nodeId) {
    event.stopPropagation();
    const toggle = event.target;
    const children = document.getElementById('children_' + nodeId);
    if (!children) return;
    const isCollapsed = children.classList.contains('collapsed');
    if (isCollapsed) {
      children.classList.remove('collapsed');
      toggle.classList.add('expanded');
    } else {
      children.classList.add('collapsed');
      toggle.classList.remove('expanded');
    }
  }

  function toggleSection(event, sectionId) {
    event.stopPropagation();
    const toggle = event.currentTarget.querySelector('.section-toggle');
    const children = document.getElementById(sectionId);
    if (!children) return;
    const isCollapsed = children.classList.contains('collapsed');
    if (isCollapsed) {
      children.classList.remove('collapsed');
      toggle.classList.remove('collapsed');
    } else {
      children.classList.add('collapsed');
      toggle.classList.add('collapsed');
    }
  }

  // ── 内容展示 ──
  let activeNode = null;
  function showContent(nodeId, event) {
    event.stopPropagation();

    // 更新激活样式
    if (activeNode) activeNode.classList.remove('active');
    const header = event.currentTarget;
    header.classList.add('active');
    activeNode = header;

    // 获取节点内容（分离知识点和错题）
    const contentEl = document.getElementById('content_' + nodeId);
    const knowledgeHTML = contentEl ? (contentEl.querySelector('.kb-knowledge')?.innerHTML || '') : '';
    const questionsHTML = contentEl ? (contentEl.querySelector('.kb-questions')?.innerHTML || '') : '';
    const qCount = (questionsHTML.match(/question-card/g) || []).length;

    // 获取面包屑路径
    const pathEls = [];
    let el = header;
    while (el && el.dataset.nodeId) {
      const label = el.querySelector('.tree-label');
      if (label) pathEls.unshift(label.textContent);
      // 向上找祖先 tree-node（跳过 children 包裹层）
      const currentNode = el.closest('.tree-node');
      const ancestorNode = currentNode ? currentNode.parentElement.closest('.tree-node') : null;
      if (ancestorNode) {
        el = ancestorNode.querySelector(':scope > .tree-node-header');
        if (!el) break;
      } else {
        // 到达 tree-section 级别
        const section = currentNode ? currentNode.closest('.tree-section') : null;
        if (section) {
          const sectionTitle = section.querySelector('.tree-section-title');
          if (sectionTitle) pathEls.unshift(sectionTitle.textContent.trim());
        }
        break;
      }
    }
    const breadcrumb = pathEls.join(' > ');
    const title = pathEls[pathEls.length - 1] || '';

    // 渲染左栏：知识点细节
    const leftPanel = document.getElementById('panel-knowledge');
    leftPanel.innerHTML = \`
      <div class="content-panel">
        <div class="content-breadcrumb">\${breadcrumb}</div>
        <div class="content-title">\${title}</div>
        \${knowledgeHTML || '<p style="color:#8C8273">该知识点暂无文字内容</p>'}
      </div>\`;

    // 渲染右栏：错题整理
    const rightPanel = document.getElementById('panel-questions');
    if (qCount > 0) {
      rightPanel.innerHTML = \`
        <div class="questions-panel-title">📝 关联错题 <span class="q-count">\${qCount}</span></div>
        \${questionsHTML}\`;
    } else {
      rightPanel.innerHTML = \`
        <div class="empty-questions">
          <div class="icon">✓</div>
          <div>该知识点<br/>暂无关联错题</div>
        </div>\`;
    }
  }
</script>
</body>
</html>`;

  return html;
}

// ─── 主导出函数 ───────────────────────────────────────────────

function exportKnowledgeBook(options = {}) {
  const { moduleFilter, withQuestions } = options;

  const trees = loadTree();
  if (!trees) {
    console.error('[export_knowledge] 知识树未解析，请先运行 parse_knowledge.js');
    return null;
  }

  // 加载错题映射
  let questionMap = null;
  if (withQuestions) {
    // 加载最新的扁平数据（含 question_ids）
    const flat = loadFlat();
    const questions = loadWrongQuestions();

    if (flat && questions.length > 0) {
      // 构建 question id → question object 映射
      questionMap = {};
      for (const q of questions) {
        questionMap[q.id] = q;
      }
    }
  }

  const html = generateHtml(trees, questionMap, { moduleFilter, withQuestions });

  const exportDir = path.join(DATA_DIR, 'exports');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const suffix = moduleFilter ? `_${moduleFilter}` : '';
  const outPath = path.join(exportDir, `知识本_${today}${suffix}.html`);

  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`[export_knowledge] 知识本已导出: ${outPath}`);

  // 复制图片到导出目录
  const imgSrcDir  = path.join(__dirname, '..', 'images');
  const imgDestDir = path.join(exportDir, 'images');
  if (fs.existsSync(imgSrcDir)) {
    if (!fs.existsSync(imgDestDir)) {
      fs.mkdirSync(imgDestDir, { recursive: true });
    }
    // 简单复制（不递归，避免体积过大）
    const files = fs.readdirSync(imgSrcDir);
    for (const f of files) {
      const src = path.join(imgSrcDir, f);
      const dest = path.join(imgDestDir, f);
      if (fs.statSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) {
          // 复制子目录
          fs.cpSync(src, dest, { recursive: true });
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }

  return outPath;
}

// ─── CLI 入口 ─────────────────────────────────────────────────

if (require.main === module) {
  const moduleArg = process.argv.find(a => a.startsWith('--module='));
  const moduleFilter = moduleArg ? moduleArg.split('=')[1] : null;
  const withQuestions = process.argv.includes('--with-questions');

  const outPath = exportKnowledgeBook({ moduleFilter, withQuestions });
  if (outPath) {
    console.log(`ATTACH:${outPath}`);
  }
}

module.exports = { exportKnowledgeBook };
