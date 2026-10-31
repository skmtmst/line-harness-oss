import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { mockFetch } from './mock-local.mjs'
import { stubApi } from './speed-budget.mjs'
import { scanDialogFooters } from './dialog-footer-browser.mjs'
import { trackPendingApiRequests, waitForNavigationContent } from './navigation-content-ready.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'

const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
const output = join(process.env.V8_GUARD_ARTIFACT_DIR || '/tmp/v8-guard', 'dialog-footer')
const recipes = [
  { path: '/affiliates?tab=affiliates', trigger: '今月の流れを確認', title: '今月の成果の流れ', reference: true },
  { path: '/friend-add-settings?view=new&step=preview', trigger: '試す条件を指定', title: 'テストの条件' },
  { path: '/friend-add-settings?view=new&step=preview', trigger: '動きの詳細を確認', title: '追加された人に起きること', reference: true },
  { path: '/broadcasts', menu: '配信を作る', trigger: 'かんたんに送る', title: 'かんたんに送る' },
]

for (const width of [1152, 1440]) test(`dialog footer ${width}`, async () => {
  const browser = await connectGuardBrowser(), video = process.env.V8_GUARD_VIDEO === '1'
  const dir = join(output, String(width)); mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width, height: 1080 }, locale: 'ja-JP', ...(video ? { recordVideo: { dir: join(dir, 'video'), size: { width, height: 1080 } } } : {}) })
  const page = await context.newPage(), pending = trackPendingApiRequests(page), rows = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, PARITY_INIT)
  await stubApi(page, async (method, path) => {
    const response = await mockFetch(method, path)
    if (new URL(path, base).pathname === '/api/staff/me') { const body = JSON.parse(response.body); body.data.accountScope = 'all'; response.body = JSON.stringify(body) }
    return response
  })
  try {
    for (const [index, recipe] of recipes.entries()) {
      const row = { ...recipe, width, normal: null, broken: null, restored: null, failure: null }; rows.push(row)
      try {
        await page.goto(base + recipe.path, { waitUntil: 'domcontentloaded' })
        await waitForNavigationContent(page, pending)
        if (recipe.menu) {
          await page.getByRole('button', { name: new RegExp(`^${recipe.menu}`) }).click()
          await page.getByRole('menuitem', { name: new RegExp(`^${recipe.trigger}`) }).click()
        } else await page.getByRole('button', { name: recipe.trigger, exact: true }).click()
        const dialog = page.getByRole('dialog', { name: recipe.title, exact: true })
        await dialog.waitFor({ state: 'visible' })
        await page.waitForFunction(() => !document.querySelector('[role="dialog"] [aria-busy="true"]'))
        row.normal = await page.evaluate(scanDialogFooters)
        await page.screenshot({ animations: 'disabled', path: join(dir, `${index}-normal.png`) })
        assert.deepEqual(row.normal, [])
        const actions = dialog.locator('[data-window-actions]')
        if (recipe.reference) {
          assert.equal(await actions.locator('button').count(), 0)
          await actions.evaluate(footer => { const button = document.createElement('button'); button.textContent = '閉じる'; button.setAttribute('data-footer-fault', ''); footer.appendChild(button) })
        } else {
          assert.ok(await actions.locator('[data-dialog-actions] button').count() > 0)
          await actions.locator('[data-dialog-actions]').first().evaluate(node => { node.setAttribute('data-footer-fault-actions', ''); node.removeAttribute('data-dialog-actions') })
        }
        row.broken = await page.evaluate(scanDialogFooters)
        assert.ok(row.broken.length > 0, '自前の下帯・参照の閉じる帯を赤にする')
        if (recipe.reference) await actions.locator('[data-footer-fault]').evaluate(node => node.remove())
        else await actions.locator('[data-footer-fault-actions]').evaluate(node => { node.setAttribute('data-dialog-actions', ''); node.removeAttribute('data-footer-fault-actions') })
        row.restored = await page.evaluate(scanDialogFooters)
        assert.deepEqual(row.restored, [])
        await page.screenshot({ animations: 'disabled', path: join(dir, `${index}-restored.png`) })
        await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
      } catch (error) { row.failure = error.stack ?? String(error); await page.screenshot({ animations: 'disabled', path: join(dir, `${index}-failed.png`) }); throw error }
    }
    assert.deepEqual(errors, [])
  } finally {
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({ rows, errors }, null, 2))
    try {
      await context.close()
      if (video) { const file = join(dir, 'navigation.webm'); await page.video().saveAs(file); assert.ok(statSync(file).size > 0) }
    } finally { await browser.close() }
  }
})
