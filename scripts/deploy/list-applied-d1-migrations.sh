#!/usr/bin/env bash
# 読むだけで適用済みの名前を返す。履歴表が無い初期DBも書き換えない。
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "usage: $0 <database-name>" >&2
  exit 2
fi
database_name=$1
history_exists=$(npx wrangler d1 execute "$database_name" --remote \
  --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'" --json \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (!Array.isArray(d) || d.length !== 1 || d[0].success === false || !Array.isArray(d[0].results)) throw new Error('履歴表を確認できません');
    console.log(d[0].results.length > 0 ? 'true' : 'false');
  ")
if [ "$history_exists" = 'false' ]; then
  echo '履歴表は未作成です。未適用として数えます（DBは変更しません）。' >&2
  exit 0
fi
npx wrangler d1 execute "$database_name" --remote --command "SELECT name FROM _migrations" --json \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (!Array.isArray(d) || d.length !== 1 || d[0].success === false || !Array.isArray(d[0].results)
      || d[0].results.some(r => typeof r.name !== 'string')) throw new Error('適用済み一覧を確認できません');
    console.log(d[0].results.map(r => r.name).join('\n'));
  "
