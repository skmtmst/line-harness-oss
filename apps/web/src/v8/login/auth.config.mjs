import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { allocateTestPort } from '../../../scripts/test-port.mjs'
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const mockPort = await allocateTestPort(process.env.TRAIN30_MOCK_PORT)
const webPort = await allocateTestPort(process.env.TRAIN30_WEB_PORT)
const base = `http://127.0.0.1:${webPort}`
process.env.TRAIN30_MOCK_PORT = String(mockPort)
process.env.TRAIN30_WEB_PORT = String(webPort)
export default defineConfig({
  outputDir: process.env.TRAIN30_OUTPUT_DIR ?? fileURLToPath(new URL('../../../test-results/train30-mfa', import.meta.url)),
  testDir: '.', testMatch: 'auth.spec.mjs', workers: 1, retries: 0,
  reporter: 'list', timeout: 60000, expect: { timeout: 15000 },
  use: { baseURL: base },
  webServer: [
    { cwd: root, command: `node apps/web/scripts/v8-guard/serve-out.mjs apps/web/out ${webPort}`, url: `${base}/login`, reuseExistingServer: false },
    { cwd: root, command: 'node scripts/visual-qa/mock-api.mjs', env: { PORT: String(mockPort) }, url: `http://127.0.0.1:${mockPort}/api/friends?account_id=visual-qa-account`, reuseExistingServer: false },
  ],
})
