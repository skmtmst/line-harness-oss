#!/usr/bin/env bash
# 列車14 P2-01〜04。APIとLINEは模擬応答、DBはメモリー上のSQLiteだけを使用する。
set -euo pipefail
STGFIX14_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$STGFIX14_ROOT"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://nen-line-stg.skmtmst.workers.dev}"
pnpm --filter web exec vitest run src/test-utils/staging14 src/components/shared/inline-edit.test.tsx src/v8/settings/pools/edit.test.tsx --maxWorkers=1
pnpm --filter worker exec vitest run src/routes/traffic-pools-save.test.ts --maxWorkers=1
git diff --check
