/*
  #685 の実ブラウザ試験だけを、実buildへ当てて動かす設定。

  `pnpm --filter web test`（vitest）は `src` の下の `.test.ts` と `.test.tsx`
  しか見ない。この試験はブラウザが要るので同じ入れ物には入らない。
  **必須ゲートから外れたままにしないため、専用の設定を置いて `web-build` の
  工程から呼ぶ。** `apps/web/src/app/contents/contents-permission-behavior.config.mjs`
  と同じ形。司令塔独立審査(Opus, 2026-09-09)の差し戻し理由が
  「実ブラウザ試験363行がRequired gateの外にある」だった。

  実行:
    pnpm --filter web build
    pnpm exec playwright test --config apps/web/src/app/ec-commerce/ec-commerce-issue-685.config.mjs
*/
import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.EC_685_PORT ?? 3151)
const BASE = process.env.EC_685_BASE ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: HERE,
  testMatch: 'ec-commerce-issue-685.spec.mjs',
  /* アカウント切替・遅延応答を秒単位のタイミングで組み立てるので、並べずに1つずつ動かす。 */
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
    command: `node ${fileURLToPath(new URL('./ec-commerce-issue-685-server.mjs', import.meta.url))}`,
    url: `${BASE}/ec-commerce.html`,
    /*
      使い回さない。前の実行が残っていると古い `out` を配り続け、
      直したはずの画面で試験が通ってしまう(media permissionの試験で
      実際に1回この事故が起きている)。
    */
    reuseExistingServer: false,
    timeout: 60_000,
    env: { EC_685_PORT: String(PORT) },
  },
})
