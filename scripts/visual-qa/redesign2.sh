#!/bin/zsh
# 書き出しが複数枚に分かれる機能ぶんを、まとめて作り直す。
#   redesign2.sh <機能番号> <dir> <html1:nodes1> <html2:nodes2> …
set -e
FEATURE="$1"; DIR="$2"; shift 2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="/tmp/split/f${FEATURE}"
rm -rf "$OUT"; mkdir -p "$OUT"
for pair in "$@"; do
  HTML="${pair%%:*}"; NODES="${pair#*:}"
  node "$ROOT/scripts/visual-qa/split-design-html.mjs" --html "$HTML" --out "$OUT" --nodes "$NODES" >/dev/null
  node "$ROOT/scripts/visual-qa/design-text.mjs" --html "$HTML" --dir "$DIR" --nodes "$NODES" >/dev/null
done
node "$ROOT/scripts/visual-qa/capture-screens.mjs" --feature "$FEATURE" --design --from "$OUT" 2>&1 | tail -1
