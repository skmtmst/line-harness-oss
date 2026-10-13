import { defineConfig } from '@playwright/test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

// NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true を渡してローカル画面を起動する。
// 見本APIとローカル画面を起動したあと：
// VISUAL_QA_BASE=http://127.0.0.1:3197 VISUAL_QA_MOCK=http://127.0.0.1:8799 pnpm exec playwright test --config=scripts/visual-qa/busy-buttons.config.mjs
const output = process.env.VISUAL_QA_OUTPUT ?? join(tmpdir(), 'lh-busy-buttons')
export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: 'busy-buttons.spec.mjs',
  timeout: 45000,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: join(output, 'results.json') }]],
  outputDir: join(output, 'artifacts'),
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
})
