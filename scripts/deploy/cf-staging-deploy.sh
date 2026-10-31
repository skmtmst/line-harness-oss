#!/usr/bin/env bash
#
# Cloudflare 側の Git 連携（Workers Builds）から呼ばれる、検証環境（nen-line-stg）
# の配備コマンド。GitHub Actions も手元のターミナルも使わない経路のために置く。
#
# Workers Builds は「Build command → Deploy command」の 2 段で動く。このスクリプトは
# Deploy command 側で、Worker のビルドは終わっている前提で次を順に行う。
#
#   1. 作業ツリーがビルド成果物で汚れていないか
#   2. 未適用の D1 マイグレーションを一覧（migrate.ts status）
#   3. 今回追加されたマイグレーションに破壊的な文が無いか（追加のみ許可）
#   4. D1 へ適用（migrate.ts apply --apply。復元点の取得は migrate.ts 側が行う）
#   5. wrangler deploy（配備元を照合できるよう版情報を渡す）
#   6. /health で配備 SHA が一致するか
#
# 既定は plan（何も書かない）。実際に当てる・配る時は CF_STAGING_DEPLOY_MODE=apply。
# 初回に Cloudflare のビルド環境で D1 操作の権限が通るかを確かめる用途もあるので、
# 「反射で走っても何も変わらない」側を既定にしている（staging-deploy.sh と同じ流儀）。
#
# 手元用の staging-deploy.sh は親リポジトリのクリーン確認を要求するため、親の無い
# ビルド環境では使えない。親に依存する確認は PR の段階（CI・司令塔）で代替する。
#
# 設定（環境変数）:
#   CF_STAGING_DEPLOY_MODE   plan | apply（既定 plan）
#   CF_STAGING_SKIP_MIGRATE  1 で D1 の工程を飛ばす（コードだけ配る時）
#   WORKERS_CI_COMMIT_SHA    Workers Builds が渡す。無ければ git rev-parse HEAD
#
# 本番（wrangler.toml / production）はこのスクリプトの対象外。環境名は固定で staging。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

STAGING_CONFIG="apps/worker/wrangler.staging.toml"
STAGING_API_URL="https://stg-api.musubo.jp"
MIGRATIONS_DIR="packages/db/migrations"
TSX="./node_modules/.bin/tsx"
WRANGLER="./node_modules/.bin/wrangler"

MODE="${CF_STAGING_DEPLOY_MODE:-plan}"
SKIP_MIGRATE="${CF_STAGING_SKIP_MIGRATE:-0}"

case "$MODE" in
  plan|apply) ;;
  *)
    echo "[NG] CF_STAGING_DEPLOY_MODE は plan か apply です: $MODE" >&2
    exit 1
    ;;
esac

step() { printf '\n=== %s ===\n' "$1"; }

if [ ! -f "$STAGING_CONFIG" ]; then
  echo "[NG] $STAGING_CONFIG がありません。" >&2
  exit 1
fi
if grep -qE '^\s*\[triggers\]' "$STAGING_CONFIG"; then
  echo "[NG] $STAGING_CONFIG に [triggers] があります。検証では予約配信を動かさない決まりです。" >&2
  exit 1
fi

step "1/6 作業ツリーの確認"
DIRTY="$(git status --short)"
if [ -n "$DIRTY" ]; then
  echo "[NG] ビルド後に作業ツリーが汚れています。成果物の置き場か .gitignore を見直してください。" >&2
  printf '%s\n' "$DIRTY" >&2
  exit 1
fi
echo "クリーンです。"

SHA="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD)}"
VERSION="$(node -p "require('./package.json').version")"
RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "配備元: $SHA（version $VERSION）"
echo "モード: $MODE"

if [ "$SKIP_MIGRATE" = "1" ]; then
  step "2/6〜4/6 D1 — スキップ（CF_STAGING_SKIP_MIGRATE=1）"
else
  step "2/6 D1 の状態（未適用の一覧）"
  "$TSX" scripts/deploy/migrate.ts status staging

  step "3/6 追加されたマイグレーションの中身の確認（追加のみ許可）"
  # 今配備されている版からの差分で「新しく足された .sql」だけを見る。
  # /health が読めない・履歴が浅くて辿れない時は、手元にある履歴の範囲で見る。
  DEPLOYED_SHA="$(curl -fsS --max-time 15 "$STAGING_API_URL/health" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.data?.git_commit??""))}catch{}})' \
    || true)"
  if [ -n "$DEPLOYED_SHA" ] && git cat-file -e "$DEPLOYED_SHA^{commit}" 2>/dev/null; then
    echo "配備中の版: $DEPLOYED_SHA から今回までの追加分を見ます。"
    NEW_SQL="$(git diff --name-only --diff-filter=A "$DEPLOYED_SHA" "$SHA" -- "$MIGRATIONS_DIR" | grep -E '\.sql$' || true)"
  else
    echo "配備中の版を辿れないため、手元の履歴で分かる範囲（直近 200 コミット）の追加分を見ます。"
    NEW_SQL="$(git log -200 --diff-filter=A --name-only --pretty=format: -- "$MIGRATIONS_DIR" | grep -E '\.sql$' | sort -u || true)"
  fi
  if [ -z "$NEW_SQL" ]; then
    echo "新しく足されたマイグレーションはありません。"
  else
    echo "確認するファイル:"
    printf '  %s\n' $NEW_SQL
    BAD=0
    for f in $NEW_SQL; do
      [ -f "$f" ] || continue
      # コメント行を除いてから、破壊的な文（表の削除・列の削除・データの書き換え・削除）を探す。
      if grep -vE '^\s*--' "$f" | grep -qiE '\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE\s+\S+\s+DROP|RENAME\s+TO|TRUNCATE|DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b'; then
        echo "[停止] $f に追加のみではない文があります。人の承認が要るので自動では当てません。" >&2
        BAD=1
      fi
      if grep -qE '^\s*--\s*migration-policy:\s*table-rebuild' "$f"; then
        echo "[停止] $f は table-rebuild（表の作り直し）です。人の承認が要るので自動では当てません。" >&2
        BAD=1
      fi
    done
    if [ "$BAD" -ne 0 ]; then
      echo "承認後は Migrate D1 の手順書（docs/migration-runbook.md）どおりに人が当ててから、再配備してください。" >&2
      exit 1
    fi
    echo "追加のみの文です。"
  fi

  step "4/6 D1 へ適用"
  if [ "$MODE" = "apply" ]; then
    "$TSX" scripts/deploy/migrate.ts apply staging --apply
  else
    "$TSX" scripts/deploy/migrate.ts apply staging
    echo "(plan のため D1 は変えていません)"
  fi
fi

step "5/6 Worker の配備"
BUILD_VARS=(
  --var "BUILD_GIT_COMMIT:$SHA"
  --var "BUILD_VERSION:$VERSION"
  --var "BUILD_RELEASED_AT:$RELEASED_AT"
)
if [ "$MODE" = "apply" ]; then
  "$WRANGLER" deploy --config "$STAGING_CONFIG" "${BUILD_VARS[@]}"
else
  "$WRANGLER" deploy --config "$STAGING_CONFIG" --dry-run "${BUILD_VARS[@]}"
  echo "(plan のため Cloudflare へは反映していません)"
fi

step "6/6 配備後の確認"
if [ "$MODE" = "apply" ]; then
  OK=0
  for i in 1 2 3 4 5 6; do
    LIVE="$(curl -fsS --max-time 15 "$STAGING_API_URL/health" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.data?.git_commit??""))}catch{}})' \
      || true)"
    if [ "$LIVE" = "$SHA" ]; then OK=1; break; fi
    echo "  まだ切り替わっていません（$i/6, live=${LIVE:-取得できず}）。10 秒待ちます。"
    sleep 10
  done
  if [ "$OK" -ne 1 ]; then
    echo "[NG] /health の git_commit が $SHA になりません。配備が反映されていないか、health が読めません。" >&2
    exit 1
  fi
  echo "/health の git_commit = $SHA を確認しました。"
else
  echo "(plan のため確認は省略)"
fi

echo
echo "完了: $MODE / $SHA"
