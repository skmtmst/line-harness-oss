import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanDialogContentRows } from './dialog-content-row-browser.mjs'

const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const css = readFileSync(new URL('../../src/components/shared/dialog-content-row.module.css', import.meta.url), 'utf8')

for (const width of [1152, 1440, 1920]) {
  test(`dialog rows keep neutral outlines and muted information at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${css}</style><section data-m1-scope style="width:432px">
        <div class="row" data-dialog-content-row><label><input type="checkbox" checked>媒体の受付を閉じた</label></div>
        <div class="row" data-dialog-content-row data-tone="muted"><span>未設定のLINEアカウント：本店</span><button>移動先を選ぶ</button></div>
      </section></html>`)
      const options = { expected: 2, muted: 1 }
      const normal = await page.evaluate(scanDialogContentRows, options)
      assert.equal(normal.findings.length, 0, JSON.stringify(normal))
      await page.getByRole('checkbox').uncheck()
      assert.equal((await page.evaluate(scanDialogContentRows, options)).findings.length, 0)
      const rows = page.locator('[data-dialog-content-row]')
      await rows.first().evaluate(el => el.style.backgroundColor = '#087a3e')
      assert.ok((await page.evaluate(scanDialogContentRows, options)).findings.some(f => f.kind === 'dialog-row-surface'))
      await rows.first().evaluate(el => el.style.backgroundColor = '')
      await rows.last().evaluate(el => el.style.outline = 'none')
      assert.ok((await page.evaluate(scanDialogContentRows, options)).findings.some(f => f.kind === 'dialog-row-outline-missing'))
      await rows.last().evaluate(el => el.style.outline = '')
      await rows.last().evaluate(el => el.style.width = '600px')
      assert.ok((await page.evaluate(scanDialogContentRows, options)).findings.some(f => f.kind === 'dialog-row-overflow'))
      await rows.last().evaluate(el => el.style.width = '')
      assert.equal((await page.evaluate(scanDialogContentRows, options)).findings.length, 0)
    } finally { await browser.close() }
  })
}
