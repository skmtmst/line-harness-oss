/*
  左メニューの上端・左端そろえの実挙動試験だけを「実build」へ当てて動かす設定。

  `pnpm --filter web test`（vitest）は `src` の下の `.test.ts` / `.test.tsx`
  しか見ない。この試験は実ブラウザが要るので同じ入れ物には入らない。
  `tag-archived-edit.config.mjs` と同じ形で、`web-build` の工程から呼ぶ
  必要ゲートへ載せる。

  実行:
    pnpm --filter web build
    pnpm exec playwright test --config apps/web/src/components/layout/sidebar-top-alignment.config.mjs
*/
import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.SIDEBAR_TOP_ALIGNMENT_PORT ?? 3111)
const BASE = process.env.SIDEBAR_TOP_ALIGNMENT_BASE ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: HERE,
  testMatch: 'sidebar-top-alignment.spec.mjs',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE,
  },
  webServer: {
    command: `node "${fileURLToPath(new URL('./sidebar-top-alignment-server.mjs', import.meta.url))}"`,
    url: `${BASE}/friends`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { SIDEBAR_TOP_ALIGNMENT_PORT: String(PORT) },
  },
})
