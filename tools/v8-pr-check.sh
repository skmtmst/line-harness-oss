#!/bin/bash
# tools/v8-pr-check.sh — PR で変わった V8 の画面を、見本と並べて報告する。
#
# 司令塔の作業フォルダの `~/lh-work/tools/v8-pr-check.sh`（v7 の同一・はみ出し・
# 高さ・役割ごとの操作まで見る重い検査）とは別の、リポジトリ内の薄い検査。
# V8 の見本（Pencil と同じ見た目）とのずれだけを見て、Markdown で報告する。
#
# 最初は報告だけ（落とさない）。終了符号は、検査の要否に関わらず、
# 道具自体が動けば 0。誤検知を減らしてから、司令塔が「落とす」に切り替える。
#
# 使い方
#   tools/v8-pr-check.sh                          # origin/codex/development との差
#   tools/v8-pr-check.sh --base <ref>             # 任意の土台との差
#   tools/v8-pr-check.sh --boards ywJ5H,mcOqK     # 板を直接指名
#
# 前に用意するもの（無ければその旨を書いて 0 で終わる）
#   node scripts/visual-qa/mock-api.mjs &
#   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec next dev --port 3101 &
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_REF="${BASE_REF:-origin/codex/development}"
BOARDS_ARG=""
OUT_DIR="$ROOT/scripts/visual-qa/v8-parity-out"

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_REF="${2:?}"; shift 2 ;;
    --boards) BOARDS_ARG="${2:?}"; shift 2 ;;
    --out) OUT_DIR="${2:?}"; shift 2 ;;
    *) echo "使い方: tools/v8-pr-check.sh [--base <ref>] [--boards a,b] [--out dir]" >&2; exit 2 ;;
  esac
done

report_only() {
  # 報告だけ。ここを通っても落とさない（終了符号 0）。
  echo "# V8 見本比較（報告だけ・落とさない）"
  echo ""
  echo "$1"
  exit 0
}

if [ -n "$BOARDS_ARG" ]; then
  BOARDS="$BOARDS_ARG"
else
  CHANGED="$(git diff --name-only "$BASE_REF"...HEAD -- apps/web/src 2>/dev/null || true)"
  if [ -z "$CHANGED" ]; then
    report_only "V8 の画面の変更なし（$BASE_REF との差に apps/web/src なし）。"
  fi
  # 変わった場所から、板か画面の場所を拾う（data-design-node と page.tsx の場所）。
  BOARDS="$(node "$ROOT/scripts/visual-qa/v8-pr-boards.mjs" "$BASE_REF" 2>/dev/null || true)"
  if [ -z "$BOARDS" ]; then
    report_only "V8 の板に結びつく変更なし（対応表の板ID・場所に当たらず）。"
  fi
fi

# 見本の写し（無ければ写す）。版には入れない。
node "$ROOT/scripts/visual-qa/sync-v8-design-refs.mjs" --boards "$BOARDS" >/dev/null 2>&1 || true

# 1枚ずつ撮る（この PC は重いので1並列）。
RESULTS=""
# shellcheck disable=SC2086
for board in $(echo "$BOARDS" | tr ',' ' '); do
  if node "$ROOT/scripts/visual-qa/v8-parity.mjs" --board "$board" --out "$OUT_DIR" >/tmp/v8-pr-check-one.log 2>&1; then
    RESULTS="$RESULTS$board $(tail -1 /tmp/v8-pr-check-one.log)
"
  else
    # 1枚の失敗（未実装・表示不能など）は全体を止めない。理由だけ残す。
    RESULTS="$RESULTS$board 撮影できず（$(tail -2 /tmp/v8-pr-check-one.log | tr '\n' ' ' | cut -c1-160)）
"
  fi
done

echo "# V8 見本比較（報告だけ・落とさない）"
echo ""
echo "対象の板: $BOARDS"
echo ""
echo '```'
echo "$RESULTS"
echo '```'
echo ""
echo "詳しい数値は scripts/visual-qa/v8-parity-out/<板ID>-<幅>/metrics.json、"
echo "並べた画像は同じフォルダの side-by-side.png・diff.png を見る。"
exit 0
