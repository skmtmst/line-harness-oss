import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { chromium } from '@playwright/test'
import { scanDialogAudit } from './dialog-layout-browser.mjs'

const path = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url))
const globals = (await postcss([tailwind()]).process(readFileSync(path, 'utf8'), { from: path })).css
const dialog = readFileSync(new URL('../../src/components/shared/dialog.module.css', import.meta.url), 'utf8')
const regressed = postcss.parse(dialog)
const componentLayer = regressed.nodes.find(node => node.type === 'atrule' && node.name === 'layer' && node.params === 'components')
for (const rule of [...regressed.nodes]) {
  if (rule.type === 'rule' && rule.selector.includes('.calloutDanger .description')) {
    rule.remove()
    componentLayer.append(rule)
  }
}

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
          await style.evaluate((el, css) => { el.textContent = css }, regressed.toString())
          const layered = await page.evaluate(scanDialogAudit)
          assert.equal(layered.findings.filter(row => row.kind === 'dialog-description-band').length, 1, 'layered rules must reproduce the gray body text')
          await style.evaluate((el, css) => { el.textContent = css }, dialog)
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
