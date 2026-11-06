/* V8 の共通情報の保存・秘密値確認・アカウント切替を、書き出した管理画面で試す。
 * 先に pnpm --filter web build を実行する。
 * pnpm exec playwright test --config apps/web/src/app/contents/vars/new/page.interaction.config.mjs
 */
import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.COMMON_VAR_INTERACTION_PORT ?? 3112)
const BASE = process.env.TEST_WEB_URL ?? `http://127.0.0.1:${PORT}`
process.env.TEST_WEB_URL = BASE

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'page.interaction.spec.ts',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { ...devices['Desktop Chrome'], baseURL: BASE },
  webServer: {
    command: `node ${fileURLToPath(new URL('../../contents-permission-behavior-server.mjs', import.meta.url))}`,
    url: `${BASE}/contents/vars/new`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { MEDIA_PERMISSION_PORT: String(PORT) },
  },
})
