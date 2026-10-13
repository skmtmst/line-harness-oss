import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const mockPort = Number(process.env.TRAIN30_MOCK_PORT ?? 8788)
export default defineConfig({
  outputDir: process.env.TRAIN30_OUTPUT_DIR ?? fileURLToPath(new URL('../../../test-results/train30-mfa', import.meta.url)),
  testDir: '.', testMatch: 'train30-auth.spec.mjs', workers: 1, retries: 0,
  reporter: 'list', timeout: 60000, expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4330' },
  webServer: [
    { cwd: root, command: 'node apps/web/scripts/v8-guard/serve-out.mjs apps/web/out 4330', url: 'http://127.0.0.1:4330/login', reuseExistingServer: false },
    { cwd: root, command: 'node scripts/visual-qa/mock-api.mjs', env: { PORT: String(mockPort) }, url: `http://127.0.0.1:${mockPort}/api/friends?account_id=visual-qa-account`, reuseExistingServer: false },
  ],
})
