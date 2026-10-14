import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { chromium } from '@playwright/test'
import { scanDialogAudit } from './dialog-layout-browser.mjs'

const path = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url))
const globals = await compileUiStyles(path)
const dialog = readFileSync(new URL('../../src/components/shared/dialog.module.css', import.meta.url), 'utf8')
for (const width of [1152, 1440, 1920]) {
  test(`dialog description bands keep their tone at ${width}`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      for (const order of [[globals, dialog], [dialog, globals]]) {
        await page.setContent(`<html data-theme="v8"><head>${order.map(css => `<style>${css}</style>`).join('')}</head><body>
          <div class="panel" data-m1-scope data-description-band="danger" role="dialog" aria-describedby="description">
            <h2 class="title">接続を解除しますか？</h2>
            <div class="callout calloutDanger"><p class="description" id="description">書き出しが止まります。</p></div>
          </div></body></html>`)
        for (const band of ['danger']) {
          await page.locator('[data-m1-scope]').evaluate((el, value) => {
            el.dataset.descriptionBand = value
            el.querySelector('.callout').className = `callout ${value === 'danger' ? 'calloutDanger' : 'calloutWarning'}`
          }, band)
          const normal = await page.evaluate(scanDialogAudit)
          assert.equal(normal.findings.length, 0, `${band}: intended tone and text size`)
          assert.equal(normal.inventory.filter(row => row.kind === 'description-band').length, 1)
          const style = page.locator('style').nth(order[0] === dialog ? 0 : 1)
          await style.evaluate(el => {
            const sheet = el.sheet
            const rules = [...sheet.cssRules]
            const index = rules.findIndex(rule => rule.selectorText?.includes('.calloutDanger .description'))
            if (index < 0) throw new Error('警告の説明の規則がない')
            const layer = rules.find(rule => rule.name === 'components')
            layer.insertRule(rules[index].cssText, layer.cssRules.length)
            sheet.deleteRule(index)
          })
          const layered = await page.evaluate(scanDialogAudit)
          assert.equal(layered.findings.filter(row => row.kind === 'dialog-description-band').length, 1, 'layered rules must reproduce the gray body text')
          await style.evaluate(el => {
            const sheet = el.sheet
            const layer = [...sheet.cssRules].find(rule => rule.name === 'components')
            const index = [...layer.cssRules].findIndex(rule => rule.selectorText?.includes('.calloutDanger .description'))
            if (index < 0) throw new Error('故障の規則がない')
            sheet.insertRule(layer.cssRules[index].cssText, sheet.cssRules.length)
            layer.deleteRule(index)
          })
          await page.locator('#description').evaluate(el => { el.style.color = 'var(--color-ink-secondary)' })
          const gray = await page.evaluate(scanDialogAudit)
          assert.equal(gray.findings.filter(row => row.kind === 'dialog-description-band').length, 1)
          await page.locator('#description').evaluate(el => { el.style.color = ''; el.style.fontSize = '13px'; el.style.lineHeight = '20px' })
          const body = await page.evaluate(scanDialogAudit)
          assert.equal(body.findings.filter(row => row.kind === 'dialog-description-band').length, 1)
          await page.locator('#description').evaluate(el => { el.removeAttribute('style') })
        }
        await page.locator('[data-m1-scope]').evaluate(el => {
          el.removeAttribute('data-description-band')
          el.querySelector('.callout').className = ''
        })
        const plain = await page.locator('#description').evaluate(el => {
          const css = getComputedStyle(el)
          return { color: css.color, fontSize: css.fontSize, lineHeight: css.lineHeight }
        })
        const expectedPlainColor = await page.evaluate(() => {
          const probe = document.createElement('span')
          probe.style.color = 'var(--color-ink-secondary)'
          document.body.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        })
        assert.deepEqual(plain, { color: expectedPlainColor, fontSize: '13px', lineHeight: '20px' })
        await page.locator('.description').evaluate(el => { el.parentElement.className = 'callout calloutWarning' })
        assert.deepEqual(await page.locator('#description').evaluate(el => {
          const css = getComputedStyle(el)
          return { color: css.color, fontSize: css.fontSize, lineHeight: css.lineHeight }
        }), plain, 'the approved warning band keeps its existing appearance')
      }
    } finally {
      await browser.close()
    }
  })
}
