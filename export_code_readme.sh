#!/usr/bin/env bash
set -euo pipefail

# 输出文件名，可通过第一个参数指定
OUT="${1:-code_readme_export.txt}"
OUT_ABS="$(realpath -m "$OUT")"

# 清空/创建输出文件
: > "$OUT_ABS"

find . \
  \( -type d \( \
    -name ".git" -o \
    -name "node_modules" -o \
    -name "venv" -o \
    -name ".venv" -o \
    -name "__pycache__" -o \
    -name "dist" -o \
    -name "build" -o \
    -name "gen" -o \
    -name "target" \
  \) -prune \) -o \
  -type f \
  \( \
    -iname "README" -o \
    -iname "README.*" -o \
    -iname "Dockerfile" -o \
    -iname "Makefile" -o \
    -iname "CMakeLists.txt" -o \
    -iregex '.*\.\(c\|h\|cpp\|hpp\|cc\|hh\|cxx\|java\|py\|sh\|bash\|zsh\|fish\|js\|mjs\|cjs\|jsx\|ts\|tsx\|go\|rs\|php\|rb\|swift\|kt\|kts\|scala\|cs\|m\|mm\|r\|lua\|pl\|pm\|sql\|html\|htm\|css\|scss\|sass\|vue\|svelte\|json\|yaml\|yml\|toml\|xml\|ini\|conf\|gradle\|cmake\|make\|mk\)$' \
  \) \
  -print0 | sort -z | while IFS= read -r -d '' file; do

    file_abs="$(realpath -m "$file")"

    # 避免把输出文件自己也导进去
    if [[ "$file_abs" == "$OUT_ABS" ]]; then
      continue
    fi

    # 跳过二进制文件
    mime="$(file -b --mime-type "$file" || true)"
    if [[ "$mime" != text/* \
       && "$mime" != application/json \
       && "$mime" != application/xml \
       && "$mime" != application/javascript \
       && "$mime" != application/x-javascript ]]; then
      continue
    fi

    rel="${file#./}"

    {
      printf '\n'
      printf '================================================================================\n'
      printf '文件: %s\n' "$rel"
      printf '================================================================================\n'
      cat "$file"
      printf '\n'
    } >> "$OUT_ABS"
  done

echo "已导出到: $OUT_ABS"
