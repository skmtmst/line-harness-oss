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
# Nothing machine-specific is hard-coded. The parent EC-CUBE repository path
# and the deploy remote are passed through to preflight from flags or
# environment variables; a parent path we cannot confirm stops the run rather
# than being guessed, because "the parent repo is clean" is one of the gates.
#
# Usage:
#   scripts/deploy/staging-deploy.sh                      # dry-run
#   scripts/deploy/staging-deploy.sh --apply              # actually deploy
#   scripts/deploy/staging-deploy.sh --apply --skip-admin # Worker only
#
# Configuration (flag wins over environment variable):
#   --parent-repo <path>  / LINE_HARNESS_PARENT_REPO   (required)
#   --remote <name>       / LINE_HARNESS_DEPLOY_REMOTE (default: origin)
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
# wrangler.staging.toml の account_id を唯一の出どころにする。ここに同じ値を
# 書き写すと、片方だけ直したときに黙って別アカウントへ配りかねない。
STAGING_ACCOUNT_ID="$(sed -n 's/^[[:space:]]*account_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$STAGING_CONFIG" | head -1)"
if [ -z "$STAGING_ACCOUNT_ID" ]; then
  echo "[NG] $STAGING_CONFIG から account_id を読み取れませんでした。" >&2
  exit 1
fi

APPLY=0
SKIP_ADMIN=0
PARENT_REPO="${LINE_HARNESS_PARENT_REPO:-}"
REMOTE="${LINE_HARNESS_DEPLOY_REMOTE:-origin}"

while [ $# -gt 0 ]; do
  case "$1" in
    # pnpm 9 may forward the option separator itself for
    # `pnpm deploy:staging -- --apply`. Treat it as syntax, not an option.
    --) ;;
    --apply) APPLY=1 ;;
    --skip-admin) SKIP_ADMIN=1 ;;
    --parent-repo)
      PARENT_REPO="${2:-}"
      shift
      ;;
    --remote)
      REMOTE="${2:-}"
      shift
      ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "不明な引数: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [ -z "$PARENT_REPO" ]; then
  cat >&2 <<'EOS'
親の EC-CUBE リポジトリが指定されていません。

  --parent-repo <path>  または  LINE_HARNESS_PARENT_REPO=<path>

PC ごとに配置が違うため既定値は持ちません。作業ツリーがクリーンかどうかは
デプロイの前提条件なので、確認できない状態では実行しません。
EOS
  exit 1
fi

if [ ! -d "$PARENT_REPO/.git" ]; then
  echo "親の EC-CUBE リポジトリが見つかりません: $PARENT_REPO" >&2
  exit 1
fi

if [ -z "$REMOTE" ]; then
  echo "デプロイ対象の remote が空です。--remote または LINE_HARNESS_DEPLOY_REMOTE で指定してください。" >&2
  exit 1
fi

TSX="./node_modules/.bin/tsx"
WRANGLER="./node_modules/.bin/wrangler"

step() { printf '\n=== %s ===\n' "$1"; }

step "1/4 事前確認（preflight）"
"$TSX" scripts/deploy/preflight.ts staging \
  --config "$STAGING_CONFIG" \
  --remote "$REMOTE" \
  --parent-repo "$PARENT_REPO"

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
  NEXT_PUBLIC_API_URL="$STAGING_API_URL" \
    NEXT_PUBLIC_RESTAURANT_TEST_ENABLED="true" \
    pnpm --filter web build
  if [ "$APPLY" -eq 1 ]; then
    # `pages deploy` は wrangler.staging.toml を読まないため、Worker と違って
    # account_id が渡らない。複数の Cloudflare アカウントに所属していると
    # 「どれか選べない」で失敗するので、Worker と同じ account を明示する。
    CLOUDFLARE_ACCOUNT_ID="$STAGING_ACCOUNT_ID" "$WRANGLER" pages deploy apps/web/out \
      --project-name "$STAGING_PAGES_PROJECT" \
      --branch main
  else
    echo "(dry-run: pages deploy は実行していません)"
  fi
fi

step "完了後の確認"
git status --short --branch
cat <<EOS

ビルド成果物で作業ツリーが汚れていないか、上の git status を確認してください。
検証が終わったら、必ずロックを解放して結果を共有してください:

  $TSX scripts/deploy/deploy-lock.ts release staging --remote $REMOTE

共有する内容: 反映コミット / 確認結果 / 未確認事項
EOS
