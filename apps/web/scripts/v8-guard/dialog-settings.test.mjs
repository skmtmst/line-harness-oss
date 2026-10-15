import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanDialogAudit } from './dialog-layout-browser.mjs'

const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const columns = readFileSync(new URL('../../src/components/shared/display-items-dialog.module.css', import.meta.url), 'utf8')
for (const width of [1152, 1440, 1920]) {
  test(`fixed columns, available columns and score meaning at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${columns}</style><div role="dialog" data-m1-scope>
        <div class="body" data-presentation="columns">
          <section aria-label="選択した列" style="outline:1px solid var(--color-hairline)"><div data-fixed-display-name><svg class="lucide-lock" role="img" aria-label="いつも表示する列" width="16" height="16"><path d="M4 8h8v6H4z" /></svg>友だち（名前）</div></section>
          <div class="options" role="group" aria-label="基本の追加できる列"><label>電話</label><label>住所</label></div>
        </div><span data-score-delta="positive" style="color:var(--color-accent-deep)">+3</span><span data-score-delta="negative" style="color:var(--color-warning)">−5</span>
      </div></html>`)
      const scan = () => page.evaluate(scanDialogAudit, { columnSettings: true, scoreHistory: true })
      assert.equal((await scan()).findings.length, 0)
      await page.getByRole('img', { name: 'いつも表示する列' }).evaluate(el => el.setAttribute('aria-label', '別の印'))
      assert.equal((await scan()).findings.filter(row => row.kind === 'display-fixed-lock-missing').length, 1)
      await page.locator('svg').evaluate(el => el.setAttribute('aria-label', 'いつも表示する列'))
      await page.locator('[data-fixed-display-name]').evaluate(el => el.removeAttribute('data-fixed-display-name'))
      assert.equal((await scan()).findings.filter(row => row.kind === 'display-fixed-name-missing').length, 1)
      await page.getByText('友だち（名前）').evaluate(el => el.setAttribute('data-fixed-display-name', ''))
      await page.locator('section').evaluate(el => el.style.outline = 'none')
      assert.equal((await scan()).findings.filter(row => row.kind === 'display-selected-frame-missing').length, 1)
      await page.locator('section').evaluate(el => el.style.outline = '1px solid var(--color-hairline)')
      await page.locator('.options').evaluate(el => el.style.gridTemplateColumns = '1fr')
      assert.equal((await scan()).findings.filter(row => row.kind === 'display-available-columns').length, 1)
      await page.locator('.options').evaluate(el => el.style.gridTemplateColumns = '')
      await page.locator('[data-score-delta]').evaluateAll(elements => elements.forEach(el => { el.style.color = 'var(--color-ink)' }))
      assert.equal((await scan()).findings.filter(row => row.kind === 'score-history-tone').length, 2)
    } finally { await browser.close() }
  })
}
