import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { scanDialogAudit } from './dialog-layout-browser.mjs'

for (const width of [1152, 1440, 1920]) {
  test(`dialog widths and nested input widths at ${width}`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent(`<style>*{box-sizing:border-box}#panel{width:560px}#content{padding:24px;width:100%}#field{width:100%;display:flex;flex-direction:column}input,textarea{width:100%}</style><div id="panel" data-m1-scope role="dialog"><div id="content" data-content-layout="form"><div data-form-requirement="required" id="field"><label>理由<textarea></textarea></label><input></div></div></div>`)
      const normal = await page.evaluate(scanDialogAudit, { expectedWidth: 560, fullForm: true })
      assert.equal(normal.findings.length, 0)
      assert.equal(normal.inventory.filter(x => x.kind === 'input').length, 2)
      const unspecified = await page.evaluate(scanDialogAudit, { expectedWidth: null })
      assert.equal(unspecified.findings.length, 0)
      await page.locator('#panel').evaluate(el => {
        const button = document.createElement('button')
        button.textContent = '理由を見る'
        el.append(button)
      })
      const explained = await page.evaluate(scanDialogAudit, { requiredAction: '理由を見る' })
      assert.equal(explained.findings.length, 0)
      await page.locator('button').evaluate(el => { el.textContent = '止める' })
      const mislabeled = await page.evaluate(scanDialogAudit, { requiredAction: '理由を見る' })
      assert.equal(mislabeled.findings.filter(x => x.kind === 'dialog-action-label').length, 1)
      await page.locator('#panel').evaluate(el => { el.style.width = '720px' })
      const wider = await page.evaluate(scanDialogAudit, { expectedWidth: 560 })
      assert.equal(wider.findings.filter(x => x.kind === 'dialog-width').length, 1)
      await page.locator('#panel').evaluate(el => { el.style.width = '480px' })
      const narrower = await page.evaluate(scanDialogAudit, { expectedWidth: 560 })
      assert.equal(narrower.findings.filter(x => x.kind === 'dialog-width').length, 1)
      await page.locator('#panel').evaluate(el => { el.style.width = '560px' })
      await page.locator('#field').evaluate(el => { el.style.width = '300px' })
      const shrunk = await page.evaluate(scanDialogAudit, { expectedWidth: 560, fullForm: true })
      assert.equal(shrunk.findings.filter(x => x.kind === 'dialog-input-width').length, 2)
    } finally {
      await browser.close()
    }
  })
}
