#!/usr/bin/env bash
#
# Guarded deploy to the validation environment (nen-line-stg).
#
# Dry-run is the default, matching the sync-oss.sh convention: a deploy that
# reaches Cloudflare requires an explicit `--apply`. The point is that running
# the wrong command by reflex should cost nothing.
#
# Order matters. Preflight runs before the build so a failing gate does not
# leave build output lying around in a work tree we just asserted was clean.
#
# Usage:
#   scripts/deploy/staging-deploy.sh              # dry-run: gates + build only
#   scripts/deploy/staging-deploy.sh --apply      # actually deploy
#   scripts/deploy/staging-deploy.sh --apply --skip-admin   # Worker only
#
# The deploy lock is NOT acquired or released here on purpose. Acquiring is a
# declaration to the other developer ("I am taking staging now"), and releasing
# is a statement that verification finished — neither should be a side effect
# of a script that might abort halfway through.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

STAGING_CONFIG="apps/worker/wrangler.staging.toml"
STAGING_API_URL="https://nen-line-stg.skmtmst.workers.dev"
STAGING_PAGES_PROJECT="nen-line-stg-admin"

APPLY=0
SKIP_ADMIN=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --skip-admin) SKIP_ADMIN=1 ;;
    -h|--help)
      sed -n '2,26p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "不明な引数: $arg" >&2
      exit 1
      ;;
  esac
done

TSX="./node_modules/.bin/tsx"
WRANGLER="./node_modules/.bin/wrangler"

step() { printf '\n=== %s ===\n' "$1"; }

step "1/4 事前確認（preflight）"
"$TSX" scripts/deploy/preflight.ts staging --config "$STAGING_CONFIG"

step "2/4 Worker ビルド"
pnpm --filter worker build

step "3/4 Worker デプロイ"
if [ "$APPLY" -eq 1 ]; then
  "$WRANGLER" deploy --config "$STAGING_CONFIG"
else
  "$WRANGLER" deploy --config "$STAGING_CONFIG" --dry-run
  echo "(dry-run のため Cloudflare へは反映していません)"
fi

if [ "$SKIP_ADMIN" -eq 1 ]; then
  step "4/4 管理画面 — スキップ"
else
  step "4/4 管理画面 ビルド＋デプロイ"
  NEXT_PUBLIC_API_URL="$STAGING_API_URL" pnpm --filter web build
  if [ "$APPLY" -eq 1 ]; then
    "$WRANGLER" pages deploy apps/web/out \
      --project-name "$STAGING_PAGES_PROJECT" \
      --branch main
  else
    echo "(dry-run: pages deploy は実行していません)"
  fi
fi

step "完了後の確認"
git status --short --branch
cat <<'EOS'

ビルド成果物で作業ツリーが汚れていないか、上の git status を確認してください。
検証が終わったら、必ずロックを解放して結果を共有してください:

  ./node_modules/.bin/tsx scripts/deploy/deploy-lock.ts release staging

共有する内容: 反映コミット / 確認結果 / 未確認事項
EOS
