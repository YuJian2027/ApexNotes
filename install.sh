#!/usr/bin/env bash
# ============================================================
# 上岸笔记 · 一键安装脚本
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  上岸笔记${NC}"
echo -e "${BLUE}  考公备考追踪工具${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── 检测 Node.js ─────────────────────────────────────────────
echo -e "${YELLOW}[1/4] 检测 Node.js...${NC}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    echo -e "  Node.js 版本: $(node -v)"
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}  错误: 需要 Node.js >= 18，当前为 $(node -v)${NC}"
        echo "  请访问 https://nodejs.org 安装最新 LTS 版本"
        exit 1
    fi
else
    echo -e "${RED}  错误: 未检测到 Node.js${NC}"
    echo "  请访问 https://nodejs.org 安装 Node.js 18+"
    exit 1
fi

# ─── 检测 Python（可选，Excel 导出需要） ──────────────────────
echo -e "${YELLOW}[2/4] 检测 Python（可选）...${NC}"
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
fi

if [ -n "$PYTHON_CMD" ]; then
    echo -e "  Python: $($PYTHON_CMD --version 2>&1)"
    echo -e "${GREEN}  ✓ Python 就绪，Excel 导出功能可用${NC}"
else
    echo -e "  ${YELLOW}⚠ 未检测到 Python，Excel 导出功能不可用${NC}"
    echo "    安装 Python: https://python.org 或 brew install python3"
fi

# ─── 安装依赖 ─────────────────────────────────────────────────
echo -e "${YELLOW}[3/4] 安装依赖...${NC}"

# Node.js 依赖（sharp：错题图批量重压优化，可选）
if [ -f "$SKILL_DIR/package.json" ]; then
    echo -e "  安装 Node 依赖（sharp）..."
    (cd "$SKILL_DIR" && npm install --no-audit --no-fund) 2>/dev/null || {
        echo -e "  ${YELLOW}⚠ npm install 失败，图片重压功能不可用（不影响核心）${NC}"
    }
fi

# Python 依赖（Excel 导出：openpyxl + Pillow）
# 必须覆盖 export_xlsx.js 实际会选用的所有 Python 候选，否则导出时找不到 Pillow
PY_CANDIDATES=(
  "$SKILL_DIR/.venv/bin/python3"
  "$HOME/.workbuddy/binaries/python/envs/default/bin/python3"
  "python3"
  "python"
)
if [ -f "$SKILL_DIR/requirements.txt" ]; then
    for py in "${PY_CANDIDATES[@]}"; do
        if [ -x "$py" ]; then
            echo -e "  为 $py 安装 Python 依赖（openpyxl + Pillow）..."
            "$py" -m pip install -r "$SKILL_DIR/requirements.txt" -q 2>/dev/null || \
                echo -e "  ${YELLOW}⚠ $py 依赖安装失败${NC}"
        fi
    done
fi

# ─── 初始化数据目录与知识框架 ─────────────────────────────────
echo -e "${YELLOW}[4/4] 初始化数据目录与知识框架...${NC}"
DATA_DIR="${APEXNOTES_DATA_DIR:-$HOME/.apexnotes/data}"
mkdir -p "$DATA_DIR/daily" "$DATA_DIR/exports" "$DATA_DIR/backups"

# 复制示例配置（如不存在）
if [ ! -f "$SKILL_DIR/config.json" ]; then
    cp "$SKILL_DIR/assets/config.example.json" "$SKILL_DIR/config.json" 2>/dev/null || true
    echo -e "  已创建 config.json（可编辑配置飞书同步等高级功能）"
fi

# ─── 初始化数据目录 + 空错题库 + 解析知识框架 ───────────────
echo ""
echo -e "${YELLOW}初始化数据目录与知识框架...${NC}"
node "$SKILL_DIR/scripts/init_demo.js" 2>/dev/null && {
    echo -e "${GREEN}  ✓ 初始化完成（空错题库 + 知识框架已解析）${NC}"
} || {
    echo -e "  ${YELLOW}⚠ 初始化失败（不影响项目运行，可手动 node scripts/init_demo.js）${NC}"
}

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  安装完成！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "数据目录: ${BLUE}$DATA_DIR${NC}"
echo -e "技能目录: ${BLUE}$SKILL_DIR${NC}"
echo ""
echo -e "下一步："
echo -e "  1. 在 Agent 中加载 ${BLUE}SKILL.md${NC}"
echo -e "  2. 说一句「今天判断推理错了8道」试试"
echo -e "  3. 查看 ${BLUE}PLATFORM_GUIDE.md${NC} 了解各平台接入方法"
echo ""
