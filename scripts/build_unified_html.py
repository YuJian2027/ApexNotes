#!/usr/bin/env python3
"""
上岸笔记 · 统一HTML构建脚本
================================
从4个Markdown文件 + 图片目录 → 生成完整的单文件HTML知识本

用法:
    cd ~/Desktop/ApexNotes
    python3 scripts/build_unified_html.py

输出:
    国考行测-上岸笔记.html

维护原则:
    - md文件是唯一数据源，HTML是生成产物
    - 修改知识框架 → 编辑md → 重新运行本脚本
    - 永远不要手动编辑HTML（会被下次构建覆盖）
"""

import os
import re
import json
import hashlib
import base64
import html as html_lib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_HTML = os.path.join(BASE, "国考行测-上岸笔记.html")
IMG_DIR = os.path.join(BASE, "images")
WRONG_DIR = os.path.join(IMG_DIR, "错题")
KNOW_DIR = os.path.join(IMG_DIR, "知识点")

# json 数据目录（wrong_questions.json 所在）
DATA_DIR = os.path.join(os.path.expanduser("~"), ".apexnotes", "data")
# 支持自定义数据路径（测试 / 多用户）：APEX_WQ_PATH 环境变量可覆盖
WQ_PATH = os.environ.get("APEX_WQ_PATH", os.path.join(DATA_DIR, "wrong_questions.json"))

# ─── 模块配置 ──────────────────────────────────────────────
MODULES = [
    {"file": "言语理解.md", "name": "言语理解", "icon": "📖"},
    {"file": "判断推理.md", "name": "判断推理", "icon": "🧩"},
    {"file": "数量关系.md", "name": "数量关系", "icon": "🔢"},
    {"file": "资料分析.md", "name": "资料分析", "icon": "📊"},
]

# ─── 工具函数 ──────────────────────────────────────────────

def make_id(label, parent_id=None):
    """根据标签文本生成8位hex ID，拼接父ID形成层级"""
    h = hashlib.md5(label.strip().encode("utf-8")).hexdigest()[:8]
    return f"{parent_id}_{h}" if parent_id else h


def clean_title(title):
    """
    清理标题前缀（和 parse_knowledge.js / backfill_from_md.js 完全一致）。
    去掉开头的中文数字序号：一、 二、 三、 等。
    用于构建 clean_path，和 wrong_questions.json 的 knowledge_path 对齐。
    注意：HTML 显示仍用原始 label，clean_label 只用于 json 关联。
    """
    return re.sub(r"^[一二三四五六七八九十]+[、，.]?\s*", "", title).strip()


def resolve_image_path(md_path):
    """
    将md中的图片路径解析为实际文件路径。
    返回 (resolved_path, is_wrong_question) 或 None。

    三种情况:
    1. 路径已含 错题/ 或 知识点/ → 直接使用
    2. 路径是旧格式 (如 images/言语1/img5.png) → 在 错题/ 和 知识点/ 中查找
    3. 找不到 → 返回None
    """
    # 去掉开头的 images/
    rel = md_path.replace("images/", "").replace("\\", "/")

    # 情况1: 路径已含分类目录
    if rel.startswith("错题/"):
        full = os.path.join(IMG_DIR, rel)
        if os.path.exists(full):
            return ("images/" + rel, True)
    if rel.startswith("知识点/"):
        full = os.path.join(IMG_DIR, rel)
        if os.path.exists(full):
            return ("images/" + rel, False)

    # 情况2: 旧格式，需要在 错题/ 和 知识点/ 中查找
    # rel 形如 "言语1/img5.png" → 文件名 "言语1_img5.png"
    parts = rel.split("/")
    if len(parts) >= 2:
        folder, filename = parts[0], parts[-1]
        merged = f"{folder}_{filename}"
    else:
        merged = rel

    # 先查错题目录
    wrong_path = os.path.join(WRONG_DIR, merged)
    if os.path.exists(wrong_path):
        return (f"images/错题/{merged}", True)

    # 再查知识点目录
    know_path = os.path.join(KNOW_DIR, merged)
    if os.path.exists(know_path):
        return (f"images/知识点/{merged}", False)

    # 也尝试原始文件名（不加前缀）
    wrong_path2 = os.path.join(WRONG_DIR, parts[-1])
    if os.path.exists(wrong_path2):
        return (f"images/错题/{parts[-1]}", True)

    know_path2 = os.path.join(KNOW_DIR, parts[-1])
    if os.path.exists(know_path2):
        return (f"images/知识点/{parts[-1]}", False)

    return None


def escape_html(text):
    """转义HTML特殊字符"""
    return html_lib.escape(text, quote=False)


def render_question_text(text):
    """将题干文字渲染为 HTML：题干 + 每个选项单独成行（ABCD 分行显示）。
    自动识别 A./B./C./D. 等选项标记并切分；无清晰选项分隔时原样转义保留换行。
    """
    if not text:
        return ""
    # 按选项标记切分（保留 A. B. 等作为每段开头）
    parts = re.split(r'(?=[A-D][.．、])', text)
    parts = [p.strip() for p in parts if p and p.strip()]
    if len(parts) <= 1:
        return f'<div class="question-text">{escape_html(text)}</div>'
    stem = parts[0]
    opts = parts[1:]
    html = '<div class="question-text">'
    if stem:
        html += f'<p class="q-stem">{escape_html(stem)}</p>'
    html += '<div class="q-opts">'
    for o in opts:
        html += f'<div class="opt-line">{escape_html(o)}</div>'
    html += '</div></div>'
    return html


def render_image_src(b64, img_path):
    """返回题面图片的 src：base64 优先（data URI），否则回退 image 路径（过渡期兼容）。"""
    if b64:
        # 按 magic byte 探测真实格式，生成正确 MIME 前缀（重压后多为 jpeg）
        try:
            raw = base64.b64decode(b64[:20])
        except Exception:
            raw = b""
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            mime = "image/png"
        elif raw[:2] == b"\xff\xd8":
            mime = "image/jpeg"
        elif raw[:4] == b"GIF8":
            mime = "image/gif"
        elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
            mime = "image/webp"
        else:
            mime = "image/png"  # 兜底
        return f"data:{mime};base64,{b64}"
    if img_path:
        return img_path
    return ""


def render_inline(text):
    """
    将markdown行内格式转为HTML。
    支持: **bold** → <strong>, *italic* → <em>
    """
    # 先转义HTML
    t = escape_html(text)
    # **bold** → <strong>（先处理双星号）
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    # *italic* → <em>（后处理单星号，避免和双星号冲突）
    t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)
    return t


# ─── Markdown 解析 ─────────────────────────────────────────

class Node:
    """知识树节点"""
    def __init__(self, label, depth, module_name, parent=None):
        self.label = label          # 原始标题（HTML显示用，保留序号）
        self.clean_label = clean_title(label)  # 清理后标题（json关联用）
        self.depth = depth  # md标题层级: 1=H1, 2=H2, ...
        self.module_name = module_name
        self.parent = parent
        self.children = []
        self.content_blocks = []  # [(type, data), ...] type: 'text'|'image'
        self.wrong_records = []   # 从 wrong_questions.json 挂载的错题记录
        self.clean_path = ""      # 用 ' > ' 连接的 clean_label 路径，匹配 json
        self.node_id = ""
        self.has_content = False
        self.has_children = False

    def compute_id(self, parent_id=None):
        """递归生成节点ID"""
        pid = parent_id if parent_id is not None else (self.parent.node_id if self.parent else None)
        self.node_id = make_id(self.label, pid)
        for child in self.children:
            child.compute_id()

    def compute_clean_path(self):
        """递归计算 clean_path（用 ' > ' 连接祖先+自己的 clean_label）"""
        if self.parent and self.parent.clean_path:
            self.clean_path = self.parent.clean_path + " > " + self.clean_label
        else:
            self.clean_path = self.clean_label
        for child in self.children:
            child.compute_clean_path()


def parse_md(filepath, module_name):
    """
    解析Markdown文件为节点树。
    返回根节点(H1)。
    """
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    root = None
    current = None  # 当前所在节点

    def get_depth(line):
        """获取标题层级，非标题返回0"""
        m = re.match(r"^(#{1,6})\s+(.+)$", line)
        if m:
            return len(m.group(1)), m.group(2).strip()
        return 0, None

    for line in lines:
        line = line.rstrip("\n")
        depth, label = get_depth(line)

        if depth > 0:
            # 这是一个标题行
            parent = None
            if depth == 1:
                # H1 = 根节点
                root = Node(label, 1, module_name, None)
                current = root
            else:
                # 找到父节点：最近的depth-1的节点
                node = current
                while node and node.depth >= depth:
                    node = node.parent
                if node is None:
                    # 没找到合适的父节点，挂到根节点下
                    node = root
                parent = node
                new_node = Node(label, depth, module_name, parent)
                parent.children.append(new_node)
                current = new_node
        else:
            # 内容行
            if current is None:
                continue

            # 空行
            if not line.strip():
                current.content_blocks.append(("text", ""))
                continue

            # 图片行: ![alt](path)
            img_match = re.match(r"^!\[(.*?)\]\((.+?)\)\s*$", line)
            if img_match:
                alt_text = img_match.group(1)
                md_path = img_match.group(2)
                resolved = resolve_image_path(md_path)
                if resolved:
                    resolved_path, is_wrong = resolved
                    if is_wrong:
                        # 错题图：json 驱动模式下跳过，由 wrong_questions.json 挂载
                        pass
                    else:
                        # 知识点图片，内联到内容中
                        current.content_blocks.append(("image", resolved_path))
                else:
                    # 图片找不到，跳过
                    pass
                continue

            # 引用行: > text
            if line.startswith(">"):
                text = line[1:].strip()
                current.content_blocks.append(("text", text))
                continue

            # 普通文本行
            current.content_blocks.append(("text", line.strip()))

    if root:
        root.compute_id()
        root.compute_clean_path()
    return root


# ─── 加载 wrong_questions.json 并挂载到节点 ──────────────────

def load_wrong_questions():
    """
    加载 wrong_questions.json，按 knowledge_path 建映射。
    返回 {knowledge_path: [record, ...]} 字典。
    """
    if not os.path.exists(WQ_PATH):
        print(f"  [警告] wrong_questions.json 不存在: {WQ_PATH}")
        return {}
    with open(WQ_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)
    path_map = {}
    for r in records:
        kp = r.get("knowledge_path", "")
        if not kp:
            continue
        path_map.setdefault(kp, []).append(r)
    print(f"  [json] 加载 {len(records)} 条错题记录，{len(path_map)} 个不同路径")
    return path_map


def attach_wrong_questions(node, path_map):
    """
    递归遍历节点树，用 node.clean_path 去 path_map 查错题记录，
    挂到 node.wrong_records。
    返回 (matched_count, total_records)。
    """
    matched = 0
    total = 0
    records = path_map.get(node.clean_path, [])
    if records:
        node.wrong_records = records
        matched += 1
        total += len(records)
    for child in node.children:
        m, t = attach_wrong_questions(child, path_map)
        matched += m
        total += t
    return matched, total


# ─── 统计错题数 ─────────────────────────────────────────────

def count_wrong_questions(node):
    """递归统计节点及其子节点的错题总数（从 wrong_records 统计）"""
    count = len(node.wrong_records)
    for child in node.children:
        count += count_wrong_questions(child)
    return count


def count_all_wrong(roots):
    """统计所有模块的错题总数"""
    total = 0
    for root in roots:
        total += count_wrong_questions(root)
    return total


# ─── HTML 生成 ─────────────────────────────────────────────

def gen_content_body(node):
    """
    生成节点的content-body HTML（左栏正文+内联图片）。
    图文按md原始顺序混排。
    """
    blocks = node.content_blocks
    # 过滤掉尾部连续空行
    while blocks and blocks[-1] == ("text", ""):
        blocks.pop()

    if not blocks and not node.wrong_records:
        # 无内容且无错题
        if node.children:
            return '<p class="text-muted">暂无详细内容，请查看子章节</p>'
        else:
            return '<p class="text-muted">暂无内容</p>'

    if not blocks:
        # 只有错题图片，没有文字
        return ""

    parts = []
    prev_empty = False
    for btype, data in blocks:
        if btype == "text":
            if data == "":
                if not prev_empty:
                    parts.append("")  # 空行占位
                prev_empty = True
            else:
                parts.append(f"<p>{render_inline(data)}</p>")
                prev_empty = False
        elif btype == "image":
            parts.append(
                f'<div class="content-image">'
                f'<img src="{data}" loading="lazy" '
                f'onerror="this.parentElement.style.display=\'none\'" alt=""/></div>'
            )
            prev_empty = False

    # 去掉开头的空行
    while parts and parts[0] == "":
        parts.pop(0)

    return "\n".join(parts)


# 错因 → 标签颜色映射
REASON_STYLES = {
    "知识点不会": ("#B93A32", "#FFF5F0"),
    "概念混淆":   ("#D85A30", "#FAECE7"),
    "粗心":       ("#BA7517", "#FAEEDA"),
    "时间不够":   ("#185FA5", "#E6F1FB"),
}
DEFAULT_REASON_STYLE = ("#888780", "#F1EFE8")

# 复习状态 → CSS 类名映射（status 字段是中文）
STATUS_CSS = {
    "待二刷": "pending",
    "复习中": "reviewing",
    "已掌握": "mastered",
}


def gen_kb_questions(node):
    """生成节点的kb-questions HTML（右栏错题卡片，从 wrong_records 渲染）"""
    if not node.wrong_records:
        return '<div class="kb-questions" data-qcount="0"></div>'

    cards = []
    for r in node.wrong_records:
        img_path = r.get("image", "")
        question_text = r.get("question_text", "")
        wq_id = r.get("id", "?")
        reason = r.get("error_reason", "未标注")
        status = r.get("status", "pending")
        date = r.get("date", "")
        confidence = r.get("knowledge_confidence", "")

        fg, bg = REASON_STYLES.get(reason, DEFAULT_REASON_STYLE)
        status_css = STATUS_CSS.get(status, "pending")

        # 错因标签
        reason_tag = (
            f'<span class="q-tag-reason" style="color:{fg};background:{bg}">'
            f'{escape_html(reason)}</span>'
        )
        # 状态标签（直接显示原始中文值，CSS类用映射）
        status_tag = f'<span class="q-tag-status status-{status_css}">{escape_html(status)}</span>'
        # 日期
        date_tag = f'<span class="q-tag-date">{escape_html(date)}</span>' if date else ""

        # 题面渲染：按 storage_method 决定展示图还是文字
        #   image 模式（图推/资料）→ 默认图；ocr_text 模式（纯文字题）→ 默认文字
        #   base64 优先（data URI），回退 image 路径（过渡期兼容 207 道旧题）
        b64 = r.get("raw_image_b64", "")
        storage_method = r.get("storage_method", "")
        want_image = bool(b64) and (storage_method != "ocr_text" or not question_text)
        want_text  = bool(question_text) and (storage_method != "image" or not b64)

        body_html = ""
        if want_image:
            src = render_image_src(b64, img_path)
            if src:
                body_html += (
                    f'<div class="question-image">'
                    f'<img src="{src}" loading="lazy" '
                    f'onerror="this.parentElement.parentElement.style.display=\'none\'" alt="错题"/></div>'
                )
        if want_text:
            body_html += render_question_text(question_text)
        if not body_html:
            body_html = ""

        # 选项标签：你选的 vs 正确的
        selected_opt = r.get("selected_option", "")
        correct_opt  = r.get("correct_option", "")
        option_html = ""
        if selected_opt or correct_opt:
            opt_parts = []
            if selected_opt:
                opt_parts.append(
                    f'<span class="q-opt q-opt-wrong">你选 {escape_html(str(selected_opt).upper())} ✗</span>'
                )
            if correct_opt:
                opt_parts.append(
                    f'<span class="q-opt q-opt-correct">正确 {escape_html(str(correct_opt).upper())} ✓</span>'
                )
            option_html = f'<div class="question-options">{"".join(opt_parts)}</div>'

        cards.append(
            f'<div class="question-card">'
            f'{body_html}'
            f'{option_html}'
            f'<div class="question-meta">'
            f'<span class="q-id">#{escape_html(str(wq_id))}</span>'
            f'{reason_tag}{status_tag}{date_tag}'
            f'</div>'
            f'</div>'
        )
    qcount = len(node.wrong_records)
    return f'<div class="kb-questions" data-qcount="{qcount}">{"".join(cards)}</div>'


def gen_content_divs(node, output):
    """递归生成所有隐藏的content div"""
    content_html = gen_content_body(node)
    questions_html = gen_kb_questions(node)
    output.append(
        f'<div id="content_{node.node_id}" style="display:none;">\n'
        f'<div class="content-body">{content_html}</div>\n'
        f'{questions_html}\n'
        f'</div>\n'
    )
    for child in node.children:
        gen_content_divs(child, output)


def gen_tree_node(node, depth_offset=2):
    """
    递归生成侧边栏树节点的DOM HTML。
    depth_offset: H2对应的depth值(2)，用于计算padding-left。
    padding-left = 30 + (depth - 2) * 16
    """
    # H1(depth=1)不渲染到树中，由module-header代替
    if node.depth == 1:
        parts = []
        for child in node.children:
            parts.append(gen_tree_node(child, depth_offset))
        return "".join(parts)

    padding = 30 + (node.depth - depth_offset) * 16
    wq_count = count_wrong_questions(node)
    has_children = len(node.children) > 0

    parts = []
    parts.append('<div class="tree-node">\n')

    # 节点header
    toggle_str = (
        f'<span class="tree-toggle" onclick="toggleNode(event,\'{node.node_id}\')"></span>'
        if has_children
        else '<span class="tree-toggle" style="visibility:hidden"></span>'
    )
    badge_str = (
        f'<span class="tree-badge">{wq_count}</span>' if wq_count > 0 else ""
    )
    parts.append(
        f'<div class="tree-node-header" data-node-id="{node.node_id}" '
        f'onclick="showContent(\'{node.node_id}\', event)" '
        f'style="padding-left:{padding}px">\n'
        f'{toggle_str}\n'
        f'<span class="tree-label">{escape_html(node.label)}</span>\n'
        f'{badge_str}\n'
        f'</div>'
    )

    # 子节点容器
    if has_children:
        parts.append(f'<div class="tree-children" id="children_{node.node_id}">')
        for child in node.children:
            parts.append(gen_tree_node(child, depth_offset))
        parts.append('</div>')

    parts.append('</div>')
    return "".join(parts)


def gen_nodes_registry(roots):
    """生成NODES JS注册表"""
    entries = []

    def walk(node):
        wq_count = count_wrong_questions(node)
        has_children = len(node.children) > 0
        has_content = len(node.content_blocks) > 0 or len(node.wrong_records) > 0

        # depth映射: H1→0, H2→2, H3→3, ...
        if node.depth == 1:
            js_depth = 0
        else:
            js_depth = node.depth

        children_ids = [c.node_id for c in node.children]
        # 确保children中包含有错题的子节点（即使没有文字内容也算hasContent）
        has_content_real = has_content or wq_count > 0

        label_escaped = node.label.replace("'", "\\'")
        entries.append(
            f"'{node.node_id}':{{label:'{label_escaped}',"
            f"children:[" + ",".join([f"'{c}'" for c in children_ids]) + "],"
            f"hasChildren:{str(has_children).lower()},"
            f"hasContent:{str(has_content_real).lower()},"
            f"depth:{js_depth},"
            f"module:'{node.module_name}'}},"
        )
        for child in node.children:
            walk(child)

    for root in roots:
        walk(root)

    return "  const NODES = {" + "".join(entries) + "};"


def gen_search_index(roots):
    """生成 SEARCH_INDEX JS变量：每个节点的 label/module/正文纯文本，供前端搜索"""
    entries = []

    def walk(node):
        text = ' '.join(
            data for btype, data in node.content_blocks
            if btype == 'text' and data
        )
        label_esc = node.label.replace("'", "\\'").replace("\n", " ")
        text_esc  = text.replace("'", "\\'").replace("\n", " ")[:600]
        entries.append(
            f"'{node.node_id}':{{label:'{label_esc}',"
            f"module:'{node.module_name}',text:'{text_esc}'}}"
        )
        for child in node.children:
            walk(child)

    for root in roots:
        walk(root)
    return "  const SEARCH_INDEX = {" + ",".join(entries) + "};"


def gen_sidebar(roots):
    """生成侧边栏HTML"""
    parts = []
    parts.append('<aside class="sidebar">\n')
    parts.append('  <div class="sidebar-header">\n')
    parts.append('    <h1>国考行测</h1>\n')
    parts.append('    <div class="subtitle">上岸笔记 · 四科知识框架与错题本</div>\n')
    parts.append('  </div>\n')

    total_wq = count_all_wrong(roots)
    module_names = ", ".join(m["name"] for m in MODULES)
    parts.append('  <div class="sidebar-stats">\n')
    parts.append(f'    <span style="color:#B93A32">✗ {total_wq} 错题</span>\n')
    parts.append(f'    <span style="color:#8C8273">{module_names}</span>\n')
    parts.append('  </div>\n\n')

    # 搜索框 + 结果容器
    parts.append('  <div class="search-box">\n')
    parts.append('    <input type="text" id="searchInput" placeholder="搜索知识点..." oninput="doSearch(this.value)" />\n')
    parts.append('  </div>\n')
    parts.append('  <div class="search-results" id="searchResults"></div>\n\n')

    for i, root in enumerate(roots):
        module = MODULES[i]
        wq_count = count_wrong_questions(root)
        module_id = root.node_id

        parts.append('<div class="module-section">\n')
        parts.append(
            f'<div class="module-header" onclick="toggleModule(event,\'{module_id}_module\')">\n'
            f'<span class="module-icon">{module["icon"]}</span>\n'
            f'<span class="module-label">{module["name"]}</span>\n'
            f'<span class="module-badge">{wq_count}</span>\n'
            f'<span class="module-toggle" id="toggle_{module_id}_module">▼</span>\n'
            f'</div>\n'
        )
        parts.append(f'<div class="module-tree" id="module_{module_id}_module">\n')
        parts.append(gen_tree_node(root))
        parts.append('</div>\n</div>\n\n')

    parts.append('</aside>\n')
    return "".join(parts)


def gen_main_panel():
    """生成主面板（初始空状态）"""
    return (
        '<div class="main">\n'
        '  <div class="content-left" id="panel-knowledge">\n'
        '    <div class="main-empty">\n'
        '      <div class="icon">📋</div>\n'
        '      <div>点击左侧知识点<br/>查看图文详解</div>\n'
        '    </div>\n'
        '  </div>\n'
        '  <div class="content-right" id="panel-questions">\n'
        '    <div class="empty-questions">\n'
        '      <div class="icon">✓</div>\n'
        '      <div>选择知识点<br/>查看关联错题</div>\n'
        '    </div>\n'
        '  </div>\n'
        '</div>\n\n'
    )


# ─── CSS 和 JS 模板 ─────────────────────────────────────────

CSS = """  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #F5F3EF;
    color: #2C2416;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .sidebar {
    width: 320px; min-width: 320px;
    background: #FFFDF7;
    border-right: 1px solid #E8E0D0;
    overflow-y: auto;
    box-shadow: 2px 0 12px rgba(0,0,0,0.04);
  }
  .sidebar-header {
    padding: 24px 20px 16px;
    border-bottom: 1px solid #E8E0D0;
    position: sticky; top: 0;
    background: #FFFDF7; z-index: 10;
  }
  .sidebar-header h1 { font-size: 20px; font-weight: 700; color: #B93A32; margin-bottom: 4px; }
  .sidebar-header .subtitle { font-size: 12px; color: #8C8273; }
  .sidebar-stats {
    display: flex; gap: 16px;
    padding: 10px 20px 14px;
    font-size: 12px; color: #8C8273;
    border-bottom: 1px solid #E8E0D0;
  }
  .module-section { border-bottom: 1px solid #F0E8D8; }
  .module-header {
    padding: 12px 20px;
    cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    background: #FFF8F0;
    border-left: 3px solid transparent;
    transition: all 0.15s;
    user-select: none;
  }
  .module-header:hover { background: #F5EDE0; }
  .module-icon { font-size: 16px; }
  .module-label { font-size: 14px; font-weight: 700; color: #4A3A2A; flex: 1; }
  .module-badge {
    background: #B93A32; color: #FFFDF7; font-size: 11px;
    padding: 2px 8px; border-radius: 10px; font-weight: 600;
  }
  .module-toggle {
    font-size: 10px; color: #8C8273; transition: transform 0.2s;
    width: 16px; text-align: center;
  }
  .module-toggle.collapsed { transform: rotate(-90deg); }
  .module-tree { overflow: hidden; }
  .module-tree.collapsed { display: none; }

  .tree-node-header {
    padding: 4px 20px 4px 20px;
    font-size: 13px; cursor: pointer;
    display: flex; align-items: center; gap: 6px;
    color: #5C5040;
    transition: background 0.12s;
    user-select: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    border-left: 2px solid transparent;
  }
  .tree-node-header:hover { background: #F2EDE0; }
  .tree-node-header.active { background: #EDE4D0; color: #B93A32; font-weight: 600; border-left-color: #B93A32; }
  .tree-toggle {
    width: 14px; height: 14px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 8px; color: #8C8273;
    transition: transform 0.2s; cursor: pointer; flex-shrink: 0; min-width: 14px;
  }
  .tree-toggle::before { content: '\\25BC'; }
  .tree-toggle.collapsed::before { content: '\\25B6'; }
  .tree-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .tree-badge { background: #B93A32; color: #FFFDF7; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; flex-shrink: 0; }
  .tree-children { overflow: hidden; }
  .tree-children.collapsed { display: none; }

  .main { flex: 1; display: flex; overflow: hidden; }
  .content-left {
    flex: 1; overflow-y: auto;
    padding: 28px 32px;
    background: #FFFDF7;
    border-right: 1px solid #E8E0D0;
  }
  .content-right {
    width: 400px; min-width: 400px;
    overflow-y: auto; padding: 28px 24px;
    background: #FAF7F0;
  }
  .content-breadcrumb { font-size: 12px; color: #B0A590; margin-bottom: 6px; }
  .content-title {
    font-size: 22px; font-weight: 700; color: #2C2416;
    margin-bottom: 24px; padding-bottom: 12px;
    border-bottom: 2px solid #E8E0D0;
  }
  .content-module-tag {
    display: inline-block; font-size: 11px;
    background: #B93A32; color: #FFFDF7;
    padding: 2px 10px; border-radius: 3px;
    margin-right: 8px; vertical-align: middle;
    font-weight: 600;
  }

  /* 内容正文 */
  .content-body p {
    margin-bottom: 3px; line-height: 1.9;
    font-size: 14px; color: #3C3020;
  }
  .content-body p strong { color: #B93A32; font-weight: 600; }
  .content-body p em { color: #6B5E4A; font-style: italic; }
  .text-muted { color: #8C8273; font-size: 14px; font-style: italic; }

  .content-image {
    margin: 12px 0;
    border: 1px solid #E8E0D0; border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    background: #FAF7F0;
  }
  .content-image img { width: 100%; height: auto; display: block; }

  /* 子章节导航 */
  .sub-chapters {
    margin-top: 28px; padding-top: 20px;
    border-top: 1px solid #E8E0D0;
  }
  .sub-chapters-label {
    font-size: 11px; color: #B0A590; margin-bottom: 12px;
    letter-spacing: 1px;
  }
  .sub-chapter-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  }
  .sub-chapter-card {
    background: #FFFDF7;
    border: 1px solid #E0D8C8;
    border-radius: 6px;
    padding: 10px 14px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex; align-items: center; gap: 8px;
  }
  .sub-chapter-card:hover {
    background: #F5EDE0;
    border-color: #C0B8A0;
    transform: translateX(2px);
  }
  .sub-chapter-arrow {
    color: #B93A32; font-size: 13px; flex-shrink: 0;
  }
  .sub-chapter-label {
    font-size: 13px; color: #4A3A2A; font-weight: 500; flex: 1;
  }
  .sub-chapter-hint {
    font-size: 10px; color: #B0A590;
  }

  /* 错题面板 */
  .questions-panel-title {
    font-size: 15px; font-weight: 700; color: #B93A32;
    margin-bottom: 16px; padding-bottom: 10px;
    border-bottom: 2px solid #E8E0D0;
  }
  .q-count { font-size: 12px; background: #B93A32; color: #FFFDF7; padding: 2px 8px; border-radius: 10px; margin-left: 6px; }
  .question-card {
    background: #FFFDF7; border: 1px solid #E8E0D0;
    border-left: 4px solid #B93A32;
    border-radius: 0 6px 6px 0;
    margin-bottom: 16px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .question-card:hover { box-shadow: 0 2px 8px rgba(185,58,50,0.15); }
  .question-image img { width: 100%; height: auto; display: block; }
  .question-options { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 8px; background: #FFFDF7; border-top: 1px solid #F0E0D8; }
  .q-opt { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 10px; white-space: nowrap; }
  .q-opt-wrong { color: #B93A32; background: #FFF0EC; border: 1px solid #F3C6BC; }
  .q-opt-correct { color: #0F6E56; background: #E1F5EE; border: 1px solid #A8DCC9; }
  .question-text {
    padding: 10px 12px; font-size: 12px; line-height: 1.6;
    color: #2C2C2A; background: #FBFAF7;
    border-bottom: 1px solid #F0E0D8;
    max-height: 220px; overflow-y: auto;
  }
  .question-text .q-stem { margin: 0 0 6px; white-space: pre-wrap; word-break: break-word; }
  .question-text .q-opts { display: flex; flex-direction: column; gap: 3px; }
  .question-text .opt-line {
    white-space: pre-wrap; word-break: break-word;
    padding: 3px 8px; border-radius: 4px; background: #FFFDF7; border: 1px solid #F0E0D8;
  }
  .question-meta {
    padding: 8px 12px; font-size: 11px;
    background: #FFFDF7;
    border-top: 1px solid #F0E0D8;
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  }
  .q-id { color: #8C8273; font-weight: 600; font-size: 11px; }
  .q-tag-reason, .q-tag-status, .q-tag-date {
    font-size: 10px; padding: 1px 7px; border-radius: 10px;
    font-weight: 600; white-space: nowrap;
  }
  .q-tag-date { color: #8C8273; background: #F1EFE8; font-weight: 400; }
  .q-tag-status.status-pending { color: #B93A32; background: #FFF5F0; }
  .q-tag-status.status-reviewing { color: #185FA5; background: #E6F1FB; }
  .q-tag-status.status-mastered { color: #0F6E56; background: #E1F5EE; }

  .main-empty {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100%; color: #C0B8A8; font-size: 15px;
  }
  .main-empty .icon { font-size: 48px; margin-bottom: 16px; }
  .empty-questions {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100%; color: #C0B8A8; font-size: 14px;
    text-align: center;
  }
  .empty-questions .icon { font-size: 32px; margin-bottom: 12px; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #D8D0C0; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #C0B8A8; }

  .search-box { padding: 10px 16px 12px; border-bottom: 1px solid #E8E0D0; }
  .search-box input {
    width: 100%; padding: 8px 12px; font-size: 13px;
    border: 1px solid #D8D0C0; border-radius: 6px;
    background: #FFFDF7; color: #2C2416; outline: none;
    transition: border-color 0.15s;
  }
  .search-box input:focus { border-color: #B93A32; }
  .search-box input::placeholder { color: #B0A590; }
  .search-results { display: none; max-height: 320px; overflow-y: auto; }
  .search-results.active { display: block; }
  .search-result-item {
    padding: 8px 16px; cursor: pointer;
    border-bottom: 1px solid #F0E8D8;
    transition: background 0.12s;
  }
  .search-result-item:hover { background: #F2EDE0; }
  .search-result-label { font-size: 13px; color: #4A3A2A; }
  .search-result-module { font-size: 11px; color: #B0A590; margin-top: 2px; }
  mark { background: #FFF3B0; color: #2C2416; padding: 0 2px; border-radius: 2px; }"""

JS = """  function toggleNode(event, nodeId) {
    event.stopPropagation();
    const toggle = event.currentTarget;
    const children = document.getElementById('children_' + nodeId);
    if (!children) return;
    children.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
  }

  function toggleModule(event, moduleId) {
    event.stopPropagation();
    const tree = document.getElementById('module_' + moduleId);
    const toggle = document.getElementById('toggle_' + moduleId);
    if (!tree) return;
    tree.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
  }

  let activeNode = null;

  function showContent(nodeId, event) {
    if (event) event.stopPropagation();
    if (activeNode && activeNode.classList) activeNode.classList.remove('active');
    const header = document.querySelector('[data-node-id="' + nodeId + '"]');
    if (header) {
      header.classList.add('active');
      activeNode = header;
    }

    const nodeInfo = NODES[nodeId];
    if (!nodeInfo) return;

    const contentEl = document.getElementById('content_' + nodeId);
    let contentHTML = '';
    if (contentEl) {
      contentHTML = contentEl.querySelector('.content-body')?.innerHTML || '';
    }

    // 构建面包屑
    const pathEls = [];
    if (header) {
      let el = header;
      for (let i = 0; i < 50; i++) {
        const labelEl = el.querySelector('.tree-label');
        if (labelEl) pathEls.unshift(labelEl.textContent);
        const node = el.closest('.tree-node');
        if (!node) break;
        const ancestor = node.parentElement?.closest('.tree-node');
        if (ancestor) {
          el = ancestor.querySelector(':scope > .tree-node-header');
          if (!el) break;
        } else break;
      }
    }
    const breadcrumb = pathEls.join(' > ');
    const title = pathEls[pathEls.length - 1] || nodeInfo.label;
    const moduleTag = '<span class="content-module-tag">' + nodeInfo.module + '</span>';

    // --- 左栏：正文 + 子章节导航 ---
    const leftPanel = document.getElementById('panel-knowledge');
    let leftHTML = '<div class="content-panel">';
    leftHTML += '<div class="content-breadcrumb">' + breadcrumb + '</div>';
    leftHTML += '<div class="content-title">' + moduleTag + title + '</div>';

    if (!contentHTML && nodeInfo.children.length === 0) {
      leftHTML += '<p class="text-muted">暂无内容</p>';
    }

    if (contentHTML) {
      leftHTML += '<div class="content-body">' + contentHTML + '</div>';
    }

    // 子章节导航（只有有子节点时才显示）
    if (nodeInfo.children.length > 0) {
      leftHTML += '<div class="sub-chapters">';
      leftHTML += '<div class="sub-chapters-label">本节内容</div>';
      leftHTML += '<div class="sub-chapter-grid">';
      for (let i = 0; i < nodeInfo.children.length; i++) {
        const cid = nodeInfo.children[i];
        const childInfo = NODES[cid];
        if (!childInfo) continue;
        const hasKids = childInfo.children.length > 0;
        const hasContent = childInfo.hasContent;
        const hint = hasKids ? (hasContent ? '' : '含子章节') : '';
        leftHTML += '<div class="sub-chapter-card" onclick="navigateTo(\\'' + cid + '\\')">';
        leftHTML += '<span class="sub-chapter-arrow">\\u25B8</span>';
        leftHTML += '<span class="sub-chapter-label">' + childInfo.label + '</span>';
        if (hint) leftHTML += '<span class="sub-chapter-hint">' + hint + '</span>';
        leftHTML += '</div>';
      }
      leftHTML += '</div></div>';
    }

    leftHTML += '</div>';
    leftPanel.innerHTML = leftHTML;

    // --- 右栏：错题 ---
    const rightPanel = document.getElementById('panel-questions');
    let questionsHTML = '';
    if (contentEl) {
      questionsHTML = contentEl.querySelector('.kb-questions')?.innerHTML || '';
    }
    const qCount = (questionsHTML.match(/question-card/g) || []).length;

    if (qCount > 0) {
      rightPanel.innerHTML = '<div class="questions-panel-title">错题<span class="q-count">' + qCount + '</span></div>' + questionsHTML;
    } else {
      rightPanel.innerHTML = '<div class="empty-questions"><div class="icon">\\u2713</div><div>该知识点<br/>暂无关联错题</div></div>';
    }
  }

  // 子章节卡片点击 -> 同时更新左侧树选中态
  function navigateTo(nodeId) {
    showContent(nodeId, null);
    // 滚动左侧树到该节点
    const header = document.querySelector('[data-node-id="' + nodeId + '"]');
    if (header) {
      header.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 展开所有祖先的children
      let parent = header.closest('.tree-children');
      while (parent) {
        parent.classList.remove('collapsed');
        const toggle = parent.previousElementSibling?.querySelector('.tree-toggle');
        if (toggle) toggle.classList.remove('collapsed');
        parent = parent.parentElement?.closest('.tree-children');
      }
    }
  }

  // ─── 全文搜索 ───
  let searchTimer = null;
  function doSearch(query) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function(){ doSearchNow(query); }, 200);
  }
  function escapeHtml(s) { return s.replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function doSearchNow(query) {
    query = query.trim();
    var resultsEl = document.getElementById('searchResults');
    var moduleTrees = document.querySelectorAll('.module-section');
    if (!query) {
      resultsEl.classList.remove('active');
      resultsEl.innerHTML = '';
      moduleTrees.forEach(function(t){ t.style.display = ''; });
      return;
    }
    moduleTrees.forEach(function(t){ t.style.display = 'none'; });
    resultsEl.classList.add('active');
    var lower = query.toLowerCase();
    var matches = [];
    for (var id in SEARCH_INDEX) {
      var info = SEARCH_INDEX[id];
      var inLabel = info.label.toLowerCase().indexOf(lower) >= 0;
      var inText  = info.text.toLowerCase().indexOf(lower) >= 0;
      if (inLabel || inText) matches.push({ id: id, label: info.label, module: info.module, inLabel: inLabel });
    }
    matches.sort(function(a,b){ return (b.inLabel?1:0) - (a.inLabel?1:0); });
    if (!matches.length) {
      resultsEl.innerHTML = '<div class="search-result-item"><div class="search-result-label">无匹配结果</div></div>';
      return;
    }
    var re = new RegExp('(' + query.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&') + ')', 'gi');
    function hl(text) { return escapeHtml(text).replace(re, '<mark>$1</mark>'); }
    resultsEl.innerHTML = matches.slice(0, 60).map(function(m){
      return '<div class="search-result-item" onclick="navigateTo(\\'' + m.id + '\\')">' +
             '<div class="search-result-label">' + hl(m.label) + '</div>' +
             '<div class="search-result-module">' + m.module + (m.inLabel?'':' · 正文') + '</div>' +
             '</div>';
    }).join('');
  }"""


# ─── 主函数 ────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("上岸笔记 · 统一HTML构建脚本")
    print("=" * 60)

    # 1. 解析4个md文件
    roots = []
    for module in MODULES:
        md_path = os.path.join(BASE, module["file"])
        if not os.path.exists(md_path):
            print(f"  [警告] 找不到文件: {module['file']}")
            continue
        print(f"  解析 {module['file']} ...", end=" ")
        root = parse_md(md_path, module["name"])
        wq = count_wrong_questions(root)
        node_count = count_nodes(root)
        print(f"{node_count} 节点, {wq} 错题")
        roots.append(root)

    if not roots:
        print("[错误] 没有找到任何md文件")
        return

    # 1.5 加载 wrong_questions.json，按 clean_path 挂载到节点
    print("\n  加载 wrong_questions.json ...")
    path_map = load_wrong_questions()
    matched_nodes = 0
    matched_records = 0
    for root in roots:
        m, t = attach_wrong_questions(root, path_map)
        matched_nodes += m
        matched_records += t
    print(f"  [json] 挂载成功: {matched_records} 条错题 → {matched_nodes} 个节点")

    total_wq = count_all_wrong(roots)
    total_nodes = sum(count_nodes(r) for r in roots)
    print(f"\n  总计: {total_nodes} 节点, {total_wq} 错题")

    # 2. 生成HTML
    print("\n  生成HTML ...", end=" ")

    html_parts = []
    html_parts.append('<!DOCTYPE html>\n')
    html_parts.append('<html lang="zh-CN">\n<head>\n')
    html_parts.append('<meta charset="UTF-8">\n')
    html_parts.append('<meta name="viewport" content="width=device-width, initial-scale=1.0">\n')
    html_parts.append('<title>国考行测 · 上岸笔记</title>\n')
    html_parts.append('<style>\n')
    html_parts.append(CSS)
    html_parts.append('\n</style>\n</head>\n<body>\n\n')

    # 侧边栏
    html_parts.append(gen_sidebar(roots))

    # 主面板
    html_parts.append(gen_main_panel())

    # 隐藏的content divs
    content_divs = []
    for root in roots:
        gen_content_divs(root, content_divs)
    html_parts.append("\n".join(content_divs))

    # NODES注册表 + JS
    html_parts.append("\n<script>\n")
    html_parts.append(gen_nodes_registry(roots))
    html_parts.append("\n\n")
    html_parts.append(gen_search_index(roots))
    html_parts.append("\n\n")
    html_parts.append(JS)
    html_parts.append("\n</script>\n")
    html_parts.append('</body>\n</html>\n')

    html_content = "".join(html_parts)

    # 3. 写入文件
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html_content)

    file_size = len(html_content.encode("utf-8"))
    print(f"完成!")
    print(f"\n  输出: {OUT_HTML}")
    print(f"  大小: {file_size / 1024:.0f} KB")
    print(f"  行数: {html_content.count(chr(10))}")
    print(f"\n  提示: 用浏览器打开HTML即可查看效果")
    print("=" * 60)


def count_nodes(node):
    """递归统计节点数"""
    count = 1
    for child in node.children:
        count += count_nodes(child)
    return count


if __name__ == "__main__":
    main()
