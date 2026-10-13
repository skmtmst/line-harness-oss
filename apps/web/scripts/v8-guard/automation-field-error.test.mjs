import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

test('保存の入力エラーは1440・1152で名前の下へ出し、画面の右端を越えない', async () => {
  const browser = await chromium.launch()
  try {
    for (const width of [1440, 1152]) {
      const page = await browser.newPage({ viewport: { width, height: 1128 }, reducedMotion: 'reduce' })
      try {
        await stubApi(page, mockFetch)
        await page.addInitScript(init => {
          for (const [key, value] of Object.entries(init)) localStorage.setItem(key, value)
        }, PARITY_INIT)
        await page.route('**/api/automation-drafts/*', async route => {
          if (route.request().method() !== 'PUT') return route.fallback()
          return route.fulfill({ status: 422, contentType: 'application/json', headers: {
            'Access-Control-Allow-Origin': route.request().headers().origin ?? 'null',
            'Access-Control-Allow-Credentials': 'true',
          }, body: JSON.stringify({
            success: false, error: '入力を確認してください', fields: { name: 'この名前は使われています' },
          }) })
        })
        const response = await page.goto(`${process.env.V8_GUARD_BASE ?? 'http://127.0.0.1:4310'}/automations/new?draft=automation-v8-new`)
        assert.ok(response?.ok())
        const input = page.locator('#v8-rule-name')
        await input.waitFor()
        await page.getByText('保存した下書きを読み込みました。続きを直せます。').last().waitFor()
        await input.fill('入力を残すルール')
        await page.getByRole('button', { name: '下書きを保存', exact: true }).click()
        const reason = page.getByText('この名前は使われています', { exact: true })
        await reason.waitFor()
        const inputBox = await input.boundingBox(), reasonBox = await reason.boundingBox()
        assert.ok(inputBox && reasonBox)
        assert.ok(reasonBox.y >= inputBox.y + inputBox.height - 1)
        assert.ok(reasonBox.x + reasonBox.width <= width)
        assert.equal(await input.inputValue(), '入力を残すルール')
        assert.equal(await input.getAttribute('aria-invalid'), 'true')
        await input.fill('直した名前')
        await reason.waitFor({ state: 'hidden' })
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})
