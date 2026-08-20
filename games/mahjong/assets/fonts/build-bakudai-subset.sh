#!/usr/bin/env bash
set -euo pipefail

source_font=${1:?"Usage: bash build-bakudai-subset.sh /path/to/Bakudai-Regular.woff2"}
font_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

python3 -m fontTools.subset "$source_font" \
  --text-file="$font_dir/mahjong-brush-text.txt" \
  --flavor=woff2 \
  --output-file="$font_dir/bakudai-mahjong.woff2"
