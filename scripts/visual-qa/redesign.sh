#!/bin/zsh
# Pencil の書き出し1枚から、設計の文字と絵をまとめて作り直す。
#
#   使い方: redesign.sh <書き出したhtml> <機能番号> <design-referenceの下の名前> <node,node,…>
#
# **絵は1ノード1ファイルでないと使えない**ので、まず割ってから撮る。
set -e
HTML="$1"; FEATURE="$2"; DIR="$3"; NODES="$4"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="/tmp/split/f${FEATURE}"
rm -rf "$OUT"; mkdir -p "$OUT"
node "$ROOT/scripts/visual-qa/split-design-html.mjs" --html "$HTML" --out "$OUT" --nodes "$NODES" >/dev/null
node "$ROOT/scripts/visual-qa/design-text.mjs" --html "$HTML" --dir "$DIR" --nodes "$NODES" >/dev/null
node "$ROOT/scripts/visual-qa/capture-screens.mjs" --feature "$FEATURE" --design --from "$OUT" 2>&1 | tail -1
