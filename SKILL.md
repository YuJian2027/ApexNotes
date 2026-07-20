---
name: apexnotes
description: >
  上岸笔记 · 行测备考追踪。基于雨哥的四模块知识框架（472节点），将错题自动挂载到对应知识点，
  导出Excel错题本（含知识路径列）和HTML知识本（交互式知识树+挂载错题）。
  触发词：行测、备考、错题、判断推理、言语理解、资料分析、数量关系、导出错题本、知识本。
---

# 上岸笔记 · 行测备考追踪

## 基础信息

- **数据目录**：`~/.apexnotes/data/`（可通过 `APEXNOTES_DATA_DIR` 环境变量覆盖）
- **知识框架**：4 个 Markdown 文件（`言语理解.md`、`判断推理.md`、`资料分析.md`、`数量关系.md`），共约 472 个知识点节点，涵盖行测全部考点

---

## 知识框架（472 节点）

四个模块的知识体系：

| 模块 | 文件 | 规模 | 覆盖内容 |
|------|------|------|---------|
| 言语理解 | `言语理解.md` | 530行 | 片段阅读（转折/因果/必要条件/并列/对策）、语句表达（填空/排序）、逻辑填空 |
| 判断推理 | `判断推理.md` | 1823行 | 图形推理（位置/样式/属性/数量规律）、定义判断、类比推理、逻辑判断（翻译/真假/加强削弱） |
| 资料分析 | `资料分析.md` | 775行 | 速算技巧、增长率/量、比重、倍数、平均数、进出口 |
| 数量关系 | `数量关系.md` | 894行 | 工程、行程、方程、排列组合、浓度、整除、数列等 |

每个知识点节点包含：完整路径、层级、知识内容（含公式/技巧/注意事项）、配图。

---

## 核心脚本

| 脚本 | 功能 | 运行方式 |
|------|------|---------|
| `scripts/parse_knowledge.js` | 解析 4 个 .md 知识文件 → `knowledge_tree.json` + `knowledge_flat.json` | `node scripts/parse_knowledge.js` |
| `scripts/link_questions.js` | 四级自动定位引擎：将错题匹配到知识框架节点 | `node scripts/link_questions.js`（CLI 测试） |
| `scripts/ingest_wrong_question.js` | **错题上传统一编排器**：定位→确认→入库，串联整条链路 | 程序化调用 / CLI 测试 |
| `scripts/parse_input.js` | 文字消息解析（科目/错题数/原因/情绪）+ 多行快捷批量 + 截图多模态识别 | 程序化调用 |
| `scripts/update_daily.js` | 写入每日记录 + 统计缓存 + 错题存档/备份 + 入库累加 | 程序化调用 |
| `scripts/build_unified_html.py` | 生成 HTML 知识本（三面板+全文搜索+挂载错题） | `python scripts/build_unified_html.py` |
| `scripts/export_xlsx.js` | 导出 Excel 错题本（含知识路径列、每日记录 sheet） | `node scripts/export_xlsx.js` |
| `scripts/weekly_report.js` | 周报：错因趋势 + 弱项模块 | 程序化调用 / automation |
| `scripts/error_reason_advisor.js` | 4种错因建议库 + 分布统计 | 被 weekly_report 调用 |
| `scripts/review_reminder.js` | 遗忘曲线复习提醒：抽到期题 → 推送 → 处理回复 → 标记已掌握 | 程序化调用 / cron |
| `scripts/init_demo.js` | 项目初始化：建数据目录 + 空错题库 + 解析知识框架（install.sh 自动调用） | `node scripts/init_demo.js` |

---

## Agent 使用流程

### 第一步：初始化

```bash
cd ~/Desktop/ApexNotes
bash install.sh
```

自动完成：安装依赖 → 解析知识框架 → 创建数据目录。

### 第二步：日常录入（三通道路由）

用户发消息后，Agent 根据 `parse_input.js` 的解析结果判断走哪个通道：

#### 通道A · 截图批量（主推）

用户发 1~N 张错题截图。Agent 用原生多模态能力逐张读图，按 `MULTIMODAL_PROMPT` 输出结构化 JSON，然后对每道调用 `ingest_wrong_question.ingestQuestion()` 定位。

#### 通道B · 快捷格式（单行/多行批量）

```
判断-逻辑判断-粗心
资料-增长率-公式不熟
言语-主旨-时间不够
```

`parseQuickEntryBatch()` 解析多行，每行一道 → `ingestBatch()` 批量定位。

单行格式 `判断-逻辑判断-粗心` 走 `parseQuickEntry()` → `ingestQuestion()` 定位。

**带题干写法**（推荐，复习时能看到题）：快捷标记后换行粘贴题干，第一行当标记、后续行当真题干存入。

```
资料-增长率-公式不熟
某省2025年GDP增长率为12%，上年为10%，求隔年增长率？
A.10% B.12% C.20% D.22%
```

→ 存为：模块=资料分析 / 题型=增长率 / 错因=公式不熟 / 题干=「某省2025…」/ 归类=比值增长率公式。
纯文字录入的题在 HTML 知识本上会渲染题干文字块（无图时），复习时能看到题重做。

#### 通道C · 自然语言打卡

```
今天判断错了8道，资料错了3道，粗心居多
```

只记模块级数据（错题数/情绪/错因），直接走 `updateDailyRecord()`，**不进 ingest 编排，不展开具体错题**。

### 第三步：ingest 编排（通道A/B 共用）

通道A/B 的每道错题经 `ingest_wrong_question.js` 统一编排：

```
解析后的错题对象
  ↓
ingestQuestion() 调用 locateQuestion() 定位 → 填充 knowledge_path
  ↓
formatCard() 展示确认卡片（**核心是核对归类 + 必填选项**）：
  【第1/3道】
  归类 → 判断推理 > 逻辑判断（精确匹配）
  关键词：逻辑判断、翻译推理
  错因：粗心
  选项：你选 B ❌ / 正确 C ✅   ← **必填项**，无论 OCR 能否识别都要在此确认/补充
  存储方式：⚠️ 请选择 → 回复「存图」或「存文字」（图推/资料默认存图）
  ────────────────
  回复"对"确认 / "归类改成XX"修正归类 / "错因改成XX"修正错因 / "你选A正确C"补选项 / "存图"或"存文字"选存储 / "跳过"丢弃
  ↓
用户确认或修正（**必须补齐 selected_option / correct_option 才能入库**）
  ↓
confirmAndSave() 入库：
  → saveWrongQuestion() 写 wrong_questions.json（带 knowledge_path）
  → incrementDailyWrongCount() 累加每日打卡（不覆盖通道C的数据）
```

**每道单独确认**：逐道展示卡片，用户回复"对"确认 / "XX改成YY"修正 / "跳过"丢弃。

> ⚠️ **选项为强制必填项**：无论 OCR / 多模态能否识别「你选的」「正确的」，确认卡片都必须显式向用户采集这两个值（展示「你选 X ❌ / 正确 Y ✅」，未识别则提示「⚠️ 未识别，请补充：你选A 正确C」）。用户未补齐 `selected_option` / `correct_option` 前，不得调用 `confirmAndSave()` 入库。
>
> ⚠️ **存储方式需用户选择**：图推/资料分析等含图、表的题 OCR 识别差，确认卡片展示 OCR 文字（或 `visual_description` 视觉描述）后，必须让用户显式选择「存图」或「存文字」（`parseStorageMethod()` 解析）。图推/资料默认存图；纯文字题可存文字省空间，但 `raw_image_b64` 仍保留作源。复习（review_reminder）对 `image` 题无法在纯文字推送里显示原图，会回退展示 `visual_description` 并提示去知识本/导出错题本看图。

### 第四步：遗忘曲线复习

- `review_reminder.js` 按艾宾浩斯遗忘曲线（1→2→4→7→15→30→60→120 天）为每道题排期
- 每天定时只推送**今天到期**的题（含逾期），不再随机抽题
- 用户回复"记得"→ 推进到下一个更长间隔；"不记得"→ 重置回第 1 天（明天再复习）
- 走完整个周期（8 次）自动标记为"已掌握"
- 调度引擎见 `eb_schedule.js`（纯函数：initState / processReview / isDue 等）

### 自动化创建（首次加载技能必做）

艾宾浩斯复习是**每日定时**任务，最优落地是在宿主 Agent 上创建**自动化程序**，用户零操作即可每天收到复习提醒。Agent 首次加载本 skill 时**必须主动完成以下初始化**：

1. **询问用户复习提醒时间**（软默认 20:00），例如："每天几点提醒你复习？默认 20:00。"
2. **调用宿主 Agent 自身的自动化能力**，创建每日定时任务：
   - 触发：每日 `用户指定时间`（RRULE `FREQ=DAILY` 或 cron `0 20 * * *`）
   - 动作：运行 `node scripts/review_reminder.js` 抽取当天到期题，按 `formatQuestionWithProgress` 逐题推送，并等待用户回复"记得/不记得"
   - 任务名建议：`ApexNotes 艾宾浩斯复习`
3. **反馈闭环**由自动化推送驱动：用户回复 → Agent 调 `review_reminder.handleReviewReply()` 推进遗忘曲线（记得→stage+1，忘了→重置）。
4. **降级兜底**：若宿主 Agent 环境不支持自动化（纯命令行/无自动化能力），退化成"用户手动每天跑一次 `node scripts/review_reminder.js`"，并在首次加载时告知用户。

> ⚠️ 此自动化由 Agent 在对话中创建，**不是 install.sh 创建**（shell 无法创建宿主 Agent 的自动化程序）。

### 第五步：导出

- **Excel 错题本**：`export_xlsx.js`，含知识路径列、原图嵌入、两个 Sheet
- **HTML 知识本**：`build_unified_html.py`，三面板（导航树+图文流+错题卡片）+ 全文搜索
  - 错题卡片的 meta 行显示「错因：xxx」+ 复习状态标签（待二刷/复习中/已掌握），**不再显示题目 ID**（对用户无意义）。状态修改在 JSON 源文件中维护，HTML 为只读展示。

---

## 数据结构

### 错题 `wrong_questions.json`

```json
[
  {
    "id": "uuid",
    "date": "2026-07-17",
    "source": "quick | quick-batch | image | ingest | backfill",
    "module": "判断推理",
    "subtype": "逻辑判断",
    "question_text": "题目文字（含 A/B/C/D 选项文本，ABCD 各占一行存储）",
    "selected_option": "A",
    "correct_option": "B",
    "answer": "B",
    "error_reason": "知识点不会 | 粗心 | 时间不够 | 概念混淆",
    "keywords": ["假言命题"],
    "status": "待二刷 | 复习中 | 已掌握",
    "knowledge_path": "判断推理 > 逻辑判断 > 翻译推理 > 假言命题",
    "knowledge_confidence": "high | medium | low | none",
    "knowledge_node_id": "判断推理.逻辑判断.翻译推理.假言命题",
    "storage_method": "image | ocr_text",
    "raw_image_b64": "<base64 编码的错题图，图推/资料题必有；ocr_text 题也保留作源防 OCR 翻车>",
    "visual_description": "<图推/资料题的模型视觉描述；纯文字题填 null>"
  }
]
```

> **图片统一存储（重要）**：错题图**一律内嵌为 `raw_image_b64` 字段**，放在 `wrong_questions.json` 里，不再使用 `images/错题/` 文件夹（已退役）。这样整份错题数据是**单个自包含 JSON**，迁移只需复制该文件。旧格式 `image` 路径字段不再使用。

> `knowledge_path` / `knowledge_confidence` / `knowledge_node_id` 三个字段由 `ingest_wrong_question.js` 编排器在入库时填充（调用 `link_questions.locateQuestion()` 定位）。通道C（自然语言打卡）不产生这些字段。
>
> **选项标签**：
> - `selected_option`：你**实际选错的**选项（如 `"A"`），记录「错在哪」
> - `correct_option`：该题**正确答案**（如 `"B"`）
> - `answer`：保留兼容字段，等于 `correct_option`（旧程序/导出沿用，新录入优先填 `correct_option`）
> - 三者均由录入阶段（截图 OCR / 快捷格式 / 自然语言）提供，编排器透传落库；缺失时存 `null`
>
> **存储方式 `storage_method`**（用户确认卡片上选择）：
> - `image`：图推/资料分析等含图、表的题 OCR 差 → 存 base64 原图，复习时看图
> - `ocr_text`：纯文字题 OCR 准 → 存 `question_text`（ABCD 分行），可省空间
> - `raw_image_b64` 对两类题**都保留**（ocr_text 也留源，防 OCR 不准时补救）

### 知识节点 `knowledge_flat.json`

```json
{
  "path": "判断推理 > 逻辑判断 > 翻译推理 > 假言命题",
  "path_id": "判断推理.逻辑判断.翻译推理.假言命题",
  "module": "判断推理",
  "level": 4,
  "content": "假言命题的推理规则...",
  "images": [{"src": "images/..."}],
  "question_ids": ["demo-001"]
}
```

---

## 自动定位引擎原理

四级逐级降级匹配：

1. **模块匹配** — 根据 `question.module` 筛选候选节点
2. **题型匹配** — 用 `subtype` 匹配节点名称/路径（如"逻辑判断→翻译推理"）
3. **关键词匹配** — 用 `keywords` 匹配节点内容
4. **内容匹配** — 提取题干中 2-5 字中文片段做全文匹配

置信度分级：`high (≥8分)` → `medium (≥5分)` → `low (≥2分)` → `fallback`

---

## 错误处理

| 场景 | 处理 |
|------|------|
| 知识框架未解析 | 提示先运行 `parse_knowledge.js` |
| 模块名无法识别 | 返回 `unknown` 路径，不阻塞后续流程 |
| 数据写入失败 | 记录错误日志，不丢失已解析的数据 |
| 截图无多模态模型 | 降级提示"把题目文字复制过来" |

---

## 文件索引

| 文件 | 用途 |
|------|------|
| `言语理解.md` / `判断推理.md` / `资料分析.md` / `数量关系.md` | 四个模块知识框架原文 |
| `scripts/parse_knowledge.js` | 知识框架解析器 |
| `scripts/link_questions.js` | 自动定位引擎（四级降级匹配） |
| `scripts/ingest_wrong_question.js` | 错题上传统一编排器（定位→确认→入库） |
| `scripts/parse_input.js` | 文字/截图解析 + 多行快捷批量 |
| `scripts/update_daily.js` | 每日记录 + 错题存储 + 入库累加 |
| `scripts/build_unified_html.py` | HTML 知识本生成（三面板+全文搜索） |
| `scripts/export_xlsx.js` | Excel 导出 |
| `scripts/weekly_report.js` | 周报（错因趋势） |
| `scripts/error_reason_advisor.js` | 错因建议库 |
| `scripts/review_reminder.js` | 遗忘曲线复习提醒（抽到期题→推送→处理回复→标记已掌握） |
| `scripts/eb_schedule.js` | 艾宾浩斯遗忘曲线调度引擎（间隔常量/排期/进度纯函数） |
| `scripts/init_demo.js` | 项目初始化（建目录+空错题库+知识树） |
| `scripts/paths.js` | 数据目录路径解析 |
| `install.sh` | 一键安装 |
| `assets/module_map.json` | 科目/原因映射 |
