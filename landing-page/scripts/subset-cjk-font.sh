#!/usr/bin/env bash
# 中文标题字体（霞鹜文楷）子集化脚本
#
# 落地页中文标题使用 LXGW WenKai，但完整中文字体有几 MB，无法整体自托管，
# 因此按 src 中实际出现的中文字符做子集，压到 ~100KB。
#
# 何时重跑：改动了中文文案、新增了含中文的 section 之后——否则新字符会缺字回退。
# 依赖：python3。脚本会自建临时 venv 安装 fonttools，并下载源 TTF。
#
# 用法：bash scripts/subset-cjk-font.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src/assets/fonts/LXGWWenKai-subset.woff2"
TTF_URL="https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 准备 fonttools venv"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install --quiet fonttools brotli

echo "==> 下载源 TTF"
curl -sL "$TTF_URL" -o "$WORK/src.ttf"

echo "==> 扫描 src 中文字符 + 标点 + ASCII"
python3 - "$ROOT" "$WORK/chars.txt" <<'PY'
import sys, pathlib
root, out = pathlib.Path(sys.argv[1]), sys.argv[2]
chars = set()
for p in (root / 'src').rglob('*.tsx'):
    for ch in p.read_text(encoding='utf-8'):
        if '一' <= ch <= '鿿':
            chars.add(ch)
punct = '，。、；：？！“”‘’（）《》【】—…·「」・％'
ascii_ = ''.join(chr(c) for c in range(0x20, 0x7f))
pathlib.Path(out).write_text(''.join(sorted(chars)) + punct + ascii_, encoding='utf-8')
print(f'   子集字符数: {len(set(chars)) }')
PY

echo "==> 子集化 → woff2"
"$WORK/venv/bin/pyftsubset" "$WORK/src.ttf" \
  --output-file="$OUT" \
  --flavor=woff2 \
  --text-file="$WORK/chars.txt" \
  --layout-features='' --no-hinting --desubroutinize

echo "==> 完成: $OUT ($(du -h "$OUT" | cut -f1))"
