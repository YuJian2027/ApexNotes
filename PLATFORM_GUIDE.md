# 平台接入指引

上岸笔记是一个**通用 Agent Skill**，不绑定任何特定平台。任何能读取 `SKILL.md` 并执行 `scripts/` 中 Node.js 脚本的 AI Agent 都可以使用。

---

## 快速自检

你的 Agent 需要满足：

| 条件 | 说明 |
|------|------|
| 能读取本地文件 | 读取 `SKILL.md` 和 `scripts/` 下的 JS 文件 |
| 能执行命令 | `node scripts/xxx.js` |
| Node.js >= 18 | 运行 JS 脚本 |
| (可选) Python 3 + openpyxl | Excel 导出 |
| (可选) 多模态模型 | 截图识别错题 |

---

## 平台接入方法

### 1. CodeBuddy / WorkBuddy

直接放到 skill 目录：

```bash
# 用户级 skill（所有项目可用）
cp -r ApexNotes ~/.workbuddy/skills/

# 或项目级 skill
cp -r ApexNotes .workbuddy/skills/
```

重启 CodeBuddy 后，说「今天判断推理错了 8 道」即可触发。

---

### 2. Cursor

在项目根目录创建 `.cursorrules` 或放入 `.cursor/skills/`：

```bash
cp -r ApexNotes .cursor/skills/
```

在对话中引用：

> 请按 `.cursor/skills/ApexNotes/SKILL.md` 的规则处理我发的备考消息。

或者直接把 `SKILL.md` 的内容粘贴到 Cursor Rules 中。

---

### 3. Trae

Trae 支持自定义 Skill：

1. 打开 Trae → 设置 → Skills
2. 点击「添加 Skill」
3. 选择 `ApexNotes/SKILL.md`
4. 配置触发词：`考公|错题|行测|申论|备考`

---

### 4. Claude Code / Claude Desktop

```bash
# 方式一：直接告诉 Claude 加载
# 在对话中粘贴 SKILL.md 内容，或：

# 方式二：通过 MCP Server 桥接
# 把 scripts/ 下的脚本注册为 MCP tools
```

---

### 5. OpenClaw

把 `assets/workspace-example.yaml` 复制到 `~/.openclaw/workspaces/`，按注释填写配置即可。

飞书接入支持定时推送（晚间总结 + 二刷提醒）。

---

### 6. 其他 Agent（opencode / Hermes / 自建）

只要 Agent 能执行 Node.js，就能用。核心流程：

1. Agent 读取 `SKILL.md` 了解规则
2. 收到用户消息 → 调用 `scripts/parse_input.js` 解析
3. 调用 `scripts/update_daily.js` 存储
4. 用户要导出 → 调用 `scripts/export_xlsx.js`

最简化的接入：把 `SKILL.md` 的全部内容复制给 Agent 作为 System Prompt。

---

## 功能一览

| 功能 | 触发方式 | 涉及脚本 |
|------|---------|---------|
| 文字打卡 | 「今天判断推理错了8道」 | `parse_input.js` → `update_daily.js` |
| 快捷录入 | 「资料-乘积增长-公式不熟-待二刷」 | `parse_input.js` |
| 截图识别 | 发送题目截图 | `parse_input.js`（需多模态模型） |
| 导出 Excel | 「导出错题本」 | `export_xlsx.js` |
| 筛选导出 | 「只导出待二刷的资料分析」 | `export_xlsx.js --pending-only --module=资料分析` |
| 晚间总结 | 定时任务（21:00） | `daily_summary.js` |
| 遗忘曲线复习提醒 | 定时任务（每天 20:00） | `review_reminder.js`（排期引擎 `eb_schedule.js`） |
| 知识本 | 「生成知识本」 | `export_knowledge_book.js` |
| 解析知识框架 | 「解析知识框架」 | `parse_knowledge.js` |
| 飞书同步 | 「同步到飞书」 | `feishu_doc.js`（需配置） |

---

## 初始状态：从空错题库开始

安装后 `init_demo.js` 会初始化一个**空错题库**（`wrong_questions.json` 为 `[]`）并解析 472 节点知识框架。所有错题由你自己的备考录入逐步积累，**不预置任何演示数据**。

```bash
node scripts/init_demo.js   # 重新初始化（已存在则跳过）
```

> 数据目录默认 `~/.apexnotes/data/`，与项目文件夹分离。分享项目时只分享文件夹本身，对方安装后建立自己的数据目录，不会包含你的错题。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APEXNOTES_DATA_DIR` | `~/.apexnotes/data` | 数据存储目录 |
| `APEXNOTES_HOME` | `~/.apexnotes` | 应用主目录 |

---

## 常见问题

**Q: 没有多模态模型，截图怎么办？**
A: 把题目文字手动复制发给 Agent，用文字方式记录，功能完全相同。

**Q: 数据存在哪里？**
A: 默认 `~/.apexnotes/data/`，纯 JSON 文件，可以用任何文本编辑器查看。

**Q: 怎么备份数据？**
A: 整个 `~/.apexnotes/data/` 目录复制即可。每次写入错题前会自动备份到 `backups/`。

**Q: 可以多设备同步吗？**
A: 用云盘（iCloud / Dropbox）同步 `~/.apexnotes/data/`，或配置飞书同步到云文档。

---

## 跨平台注意事项（mac / Windows）

知识框架的 4 个 `.md` 文件和 `images/` 下大量使用**中文文件名**。mac 与 Windows 间用 zip 传递时，编码差异会导致文件名乱码、图片缺失。

**现象**：mac 打包 → Windows 解压后，`言语理解.md` 变乱码文件名，`images/错题/` 下图片大量缺失（如 580 张只解出 13 张）。

**根因**：mac 的 `zip` 默认用 UTF-8 存文件名但不打 UTF-8 标志位，Windows 解压工具按本地编码（cp437）解读，中文全误读。

**正确做法（任选其一）**：
- 打包端（mac）：用 Keka 勾选「UTF-8 编码」，或终端 `zip -r -X ApexNotes.zip ApexNotes/`
- 解压端（Windows）：用 7-Zip 解压，不要用系统自带解压
- 已损坏补救：用 Python 修复文件名 `name.encode('cp437').decode('utf-8')` 后重命名

**最佳实践**：用 Git 同步项目（`clone` / `pull`）彻底规避 zip 编码问题；数据目录 `~/.apexnotes/data/` 不进 Git，单独用云盘同步。
