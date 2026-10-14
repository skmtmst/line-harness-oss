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
const choices = readFileSync(new URL('../../src/components/shared/dialog-choice-cards.module.css', import.meta.url), 'utf8')

for (const width of [1152, 1440, 1920]) {
  test(`choice links and plain usage keep their roles at ${width}`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.setContent(`<html data-theme="v8"><head><style>${globals}</style><style>${choices}</style></head><body>
        <div role="dialog" data-m1-scope>
          <div class="grid" data-dialog-choice-cards><section class="card"><a class="link" href="/templates/edit"><span class="title">メッセージ</span></a></section></div>
          <table aria-label="使っている所"><tbody><tr><td><span>名前</span></td><td><a target="_blank" href="/broadcasts"><span>開いて差し替える</span><svg aria-hidden="true"></svg></a></td></tr></tbody></table>
        </div></body></html>`)
      const scan = () => page.evaluate(scanDialogAudit, { choices: true, plainUsage: true })
      await page.locator('.link').hover()
      assert.equal((await scan()).findings.length, 0)
      await page.locator('.link').focus()
      assert.equal((await scan()).findings.length, 0)
      await page.locator('.link').evaluate(el => { el.style.background = 'var(--color-canvas-sunken)' })
      await page.waitForFunction(() => {
        const link = document.querySelector('.link')
        const probe = document.createElement('span')
        probe.style.background = 'var(--color-canvas-sunken)'
        document.body.append(probe)
        const expected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return expected !== 'rgba(0, 0, 0, 0)' && getComputedStyle(link).backgroundColor === expected
      })
      assert.equal((await scan()).findings.filter(f => f.kind === 'dialog-choice-label-background').length, 1)
      await page.locator('.link').evaluate(el => { el.style.background = '' })
      await page.locator('.link').evaluate(el => { el.style.backgroundImage = 'linear-gradient(var(--color-canvas-sunken), var(--color-canvas-sunken))' })
      assert.equal((await scan()).findings.filter(f => f.kind === 'dialog-choice-label-background').length, 1)
      await page.locator('.link').evaluate(el => { el.style.backgroundImage = '' })
      await page.locator('table td').first().evaluate(el => {
        const dot = document.createElement('span')
        dot.dataset.folderDot = ''
        el.append(dot)
      })
      await page.locator('table a').evaluate(el => el.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg')))
      const extra = (await scan()).findings
      assert.equal(extra.filter(f => f.kind === 'dialog-usage-folder-dots').length, 1)
      assert.equal(extra.filter(f => f.kind === 'dialog-usage-external-icons').length, 1)
      await page.locator('[data-folder-dot]').evaluate(el => el.remove())
      await page.locator('table a svg').last().evaluate(el => el.remove())
      assert.equal((await scan()).findings.length, 0)
      await page.close()
    } finally { await browser.close() }
  })
}
