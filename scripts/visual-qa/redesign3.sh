#!/bin/zsh
# 1枚の書き出しに複数機能が入るときに、機能ごとへ割って撮る。
#   redesign3.sh <html> <全nodeを機能:dir:nodes の形で並べたもの…>
# 例: redesign3.sh f.html "14:common-vars-v6:WuKzU,gBtaK" "15:media-v6:g89Tc"
set -e
HTML="$1"; shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ALLDIR="/tmp/split/all-$$"
rm -rf "$ALLDIR"; mkdir -p "$ALLDIR"
# 全nodeを順に並べる（書き出しの順と同じでなければならない）
ALL=""
for spec in "$@"; do
  N="${spec##*:}"
  ALL="${ALL:+$ALL,}$N"
done
node "$ROOT/scripts/visual-qa/split-design-html.mjs" --html "$HTML" --out "$ALLDIR" --nodes "$ALL" >/dev/null
for spec in "$@"; do
  F="${spec%%:*}"; REST="${spec#*:}"; DIR="${REST%%:*}"; N="${REST#*:}"
  OUT="/tmp/split/f${F}"; rm -rf "$OUT"; mkdir -p "$OUT"
  for n in ${(s:,:)N}; do cp "$ALLDIR/$n.html" "$OUT/"; done
  node "$ROOT/scripts/visual-qa/design-text.mjs" --html "$HTML" --dir "$DIR" --nodes "$(echo $N | sed "s/[^,]*/$DIR:&/g")" >/dev/null 2>&1 || \
    node "$ROOT/scripts/visual-qa/design-text.mjs" --html "$HTML" --dir "$DIR" --nodes "$ALL" >/dev/null 2>&1 || true
  node "$ROOT/scripts/visual-qa/capture-screens.mjs" --feature "$F" --design --from "$OUT" 2>&1 | tail -1
done
rm -rf "$ALLDIR"
