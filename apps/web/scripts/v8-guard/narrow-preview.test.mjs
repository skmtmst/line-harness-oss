import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

const root = resolve(new URL('../../out/', import.meta.url).pathname)
const map = JSON.parse(readFileSync(new URL('../../../../scripts/visual-qa/v8-design-map.json', import.meta.url)))
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

test('狭い作成画面の見え方は1回で開き、二重の入口を出さず閉じても入力を保つ', async () => {
  assert.ok(existsSync(join(root, 'version.json')), '本物の静的出力を先に組み立てる')
  const server = createServer((req, res) => {
    const path = resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`)
    const file = [path, `${path}.html`, join(path, 'index.html')].find(file => file.startsWith(`${root}/`) && existsSync(file) && statSync(file).isFile())
    if (!file) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch()
  try {
    for (const board of ['K7HWG', 'u5YC6', 'U8Xm3X', 'JeINq', 'V6xAo']) {
      const spec = map.boards[board]
      const page = await browser.newPage({ viewport: { width: 1152, height: 1128 } })
      try {
        await stubApi(page, mockFetch)
        await page.addInitScript(init => { for (const [key, value] of Object.entries(init)) localStorage.setItem(key, value) }, PARITY_INIT)
        const response = await page.goto(base + spec.url)
        assert.ok(response?.ok(), board)
        await page.waitForLoadState('networkidle')
        const trigger = page.locator('main [class*="asideToggle"] button:visible')
        await trigger.waitFor()
        const before = await page.locator('main input:visible,main textarea:visible').evaluateAll(els => els.map(el => [el.id, el.value]))
        await trigger.click()
        const dialogs = page.locator('[role="dialog"]:visible,[role="alertdialog"]:visible')
        assert.equal(await dialogs.count(), 1, board)
        assert.equal(await dialogs.locator('button:visible').filter({ hasText: /LINEで(?:の)?見え方(?:を)?見る/ }).count(), 0, `${board}: 見え方の窓をさらに開かせない`)
        if (board === 'K7HWG') assert.ok(await dialogs.getByText('設定内容', { exact: true }).count())
        else assert.ok(await dialogs.locator('[data-line-preview-part="phone"]:visible').count(), `${board}: 見え方そのものを出す`)
        await dialogs.getByRole('button', { name: '閉じる', exact: true }).first().click()
        assert.equal(await dialogs.count(), 0, board)
        assert.deepEqual(await page.locator('main input:visible,main textarea:visible').evaluateAll(els => els.map(el => [el.id, el.value])), before, board)
      } finally { await page.close() }
    }
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})
