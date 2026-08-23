#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <database-name> <pending-migrations-file>" >&2
  exit 2
fi

database_name=$1
pending_file=$2
summary_file=${GITHUB_STEP_SUMMARY:-}
last_executed='なし'
last_recorded='なし'
applied_count=0

append_summary() {
  if [ -n "$summary_file" ]; then
    cat >> "$summary_file"
  else
    cat >/dev/null
  fi
}

stop_after_failure() {
  local migration_name=$1
  local phase=$2

  {
    echo
    echo "### D1マイグレーション適用停止"
    echo
    echo "- 適用処理まで完了: \`$last_executed\`"
    echo "- 適用記録まで完了: \`$last_recorded\`"
    echo "- 停止したファイル: \`$migration_name\`"
    echo "- 失敗した処理: $phase"
    echo
    echo "このファイルの内容をDBの現状と照らして確認してから、再度実行してください。"
  } | append_summary

  echo "::error::D1 migration stopped at $migration_name ($phase)." >&2
  exit 1
}

if [ ! -f "$pending_file" ]; then
  stop_after_failure '未適用一覧' '一覧ファイルの読み取り'
fi

if [ ! -s "$pending_file" ]; then
  echo "No pending migrations."
  exit 0
fi

while IFS= read -r migration_file || [ -n "$migration_file" ]; do
  [ -z "$migration_file" ] && continue

  if [[ ! "$migration_file" =~ ^packages/db/migrations/[0-9]+_[A-Za-z0-9._-]+\.sql$ ]] \
    || [ ! -f "$migration_file" ]; then
    stop_after_failure "$migration_file" '一覧ファイルの検証'
  fi

  migration_name=$(basename "$migration_file")
  echo "Applying: $migration_name"

  if ! npx wrangler d1 execute "$database_name" --remote --file="$migration_file"; then
    stop_after_failure "$migration_name" 'マイグレーション本体の実行'
  fi
  last_executed=$migration_name

  if ! npx wrangler d1 execute "$database_name" --remote --command \
    "INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES ('${migration_name}', datetime('now'))"; then
    stop_after_failure "$migration_name" '適用済み記録の保存'
  fi

  last_recorded=$migration_name
  applied_count=$((applied_count + 1))
done < "$pending_file"

{
  echo
  echo "### D1マイグレーション適用完了"
  echo
  echo "- 適用・記録完了: ${applied_count} 件"
  echo "- 最後に適用したファイル: \`$last_recorded\`"
} | append_summary
