#!/usr/bin/env bash
# 中文字体子集化脚本（两款：思源宋体标题 + 霞鹜文楷副标）
#
# 落地页中文展示字体自托管，但完整 CJK 字体动辄数 MB，无法整体打包，
# 因此按 src 中实际出现的中文字符做子集，各压到 ~100-150KB。
#   · 思源宋体 Noto Serif SC SemiBold —— 大标题（font-display 在中文页的回退），电影感/编辑感
#   · 霞鹜文楷 LXGW WenKai            —— 副标/正文点缀（font-kai），柔和书写气质
#
# 何时重跑：改动了中文文案、新增了含中文的 section 之后——否则新字符会缺字回退。
# 依赖：python3。脚本会自建临时 venv 安装 fonttools，并下载源字体。
#
# 用法：bash scripts/subset-cjk-font.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FONT_DIR="$ROOT/src/assets/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 源字体：URL|输出文件名
SERIF_URL="https://github.com/notofonts/noto-cjk/raw/main/Serif/SubsetOTF/SC/NotoSerifSC-SemiBold.otf"
KAI_URL="https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf"

echo "==> 准备 fonttools venv"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install --quiet fonttools brotli

echo "==> 扫描 src 中文字符 + 标点 + ASCII"
python3 - "$ROOT" "$WORK/chars.txt" <<'PY'
import sys, pathlib
root, out = pathlib.Path(sys.argv[1]), sys.argv[2]
chars = set()
# 扫 tsx 组件与 i18n locale json，覆盖所有可能用中文展示字体渲染的中文
files = list((root / 'src').rglob('*.tsx')) + list((root / 'src').rglob('*.json'))
for p in files:
    for ch in p.read_text(encoding='utf-8'):
        if '一' <= ch <= '鿿':
            chars.add(ch)
punct = '，。、；：？！“”‘’（）《》【】—…·「」・％'
ascii_ = ''.join(chr(c) for c in range(0x20, 0x7f))
pathlib.Path(out).write_text(''.join(sorted(chars)) + punct + ascii_, encoding='utf-8')
print(f'   子集字符数: {len(set(chars))}')
PY

subset() {
  local url="$1" src="$2" outname="$3"
  echo "==> 下载 $outname 源字体"
  curl -sL "$url" -o "$WORK/$src"
  echo "==> 子集化 → $outname"
  "$WORK/venv/bin/pyftsubset" "$WORK/$src" \
    --output-file="$FONT_DIR/$outname" \
    --flavor=woff2 \
    --text-file="$WORK/chars.txt" \
    --layout-features='' --no-hinting --desubroutinize
  echo "   完成: $outname ($(du -h "$FONT_DIR/$outname" | cut -f1))"
}

subset "$SERIF_URL" "serif.otf" "NotoSerifSC-subset.woff2"
subset "$KAI_URL"   "kai.ttf"   "LXGWWenKai-subset.woff2"

echo "==> 全部完成"
