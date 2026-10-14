import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { scanDialogAudit } from './dialog-layout-browser.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const cssPath = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url))
const globals = (await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })).css
const dialog = readFileSync(new URL('../../src/components/shared/dialog.module.css', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../../src/components/shared/entity-picker.module.css', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../src/components/shared/source-picker-dialog.module.css', import.meta.url), 'utf8')

for (const width of [1152, 1440, 1920]) {
  test(`picker actions stay visible with long content at ${width}`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width, height: 700 }, reducedMotion: 'reduce' })
      await page.setContent(`<html><head><style>${globals}</style><style>${dialog}\n${picker}\n${shell}</style></head><body>
        <div class="overlay"><div class="panel standardPanel" data-m1-scope data-design-width data-design-content-padding style="--dialog-design-width:640px;--dialog-design-content-padding:0">
          <div class="headerRow"><h2>テンプレートを選ぶ</h2></div>
          <div class="content" data-content-layout="form"><div class="body tpBody"><section class="tpList"><div style="height:1600px;flex-shrink:0">候補と見え方</div></section></div></div>
          <div class="footer"><div class="tpFoot"><button>キャンセル</button><button>このテンプレートを使う</button></div></div>
        </div></div></body></html>`)
      const options = { fixedActions: ['キャンセル', 'このテンプレートを使う'] }
      const normal = await page.evaluate(scanDialogAudit, options)
      assert.equal(normal.findings.length, 0)
      assert.equal(normal.inventory.filter(row => row.kind === 'fixed-action').length, 2)
      await page.locator('.tpList').evaluate(el => { el.scrollTop = el.scrollHeight })
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.length, 0)
      await page.locator('.footer').evaluate(el => {
        const content = document.querySelector('.content')
        el.prepend(content.firstElementChild)
        content.remove()
        el.querySelector('.tpBody').style.height = '1600px'
        el.querySelector('.tpBody').style.maxHeight = 'none'
      })
      assert.equal(await page.locator('.tpBody').evaluate(el => el.getBoundingClientRect().height), 1600)
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.filter(row => row.kind === 'dialog-fixed-action-hidden').length, 2)
      await page.locator('button').first().evaluate(el => { el.remove() })
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.filter(row => row.kind === 'dialog-fixed-action-missing').length, 1)
    } finally { await browser.close() }
  })
}

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
      await page.locator('#panel').evaluate(el => {
        const header = document.createElement('div')
        header.innerHTML = '<h2 style="margin:0">止める</h2>'
        el.prepend(header)
        const description = document.createElement('p')
        description.id = 'dialog-description'
        description.style.margin = '0'
        description.textContent = '止めているあいだ配信されません。あとで再開できます。'
        header.after(description)
        el.setAttribute('aria-describedby', description.id)
      })
      const padded = await page.evaluate(scanDialogAudit, { compactBody: true })
      assert.equal(padded.findings.filter(x => x.kind === 'dialog-header-body-gap').length, 1)
      await page.locator('#content').evaluate(el => { el.style.paddingTop = '0'; el.style.marginTop = '14px' })
      const compact = await page.evaluate(scanDialogAudit, { compactBody: true })
      assert.equal(compact.findings.filter(x => x.kind === 'dialog-header-body-gap').length, 0)
    } finally {
      await browser.close()
    }
  })
}
