import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

test('必須札は隠したラベルでも文字幅を保ち、伸びる故障を検出する', async () => {
  const css = readFileSync(new URL('../../src/components/shared/form-controls.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>:root{--radius-pill:99px;--polish-space-row:8px;--polish-text-note:11px;--tpl-field-badge-lh:17px}${css}</style><main>
        <div class="field"><div class="labelRow"><label class="label">名前</label><span class="required" data-required-badge>必須</span></div><input aria-label="名前"></div>
        <div class="field"><span class="required" data-required-badge>必須</span><input aria-label="探す欄"></div>
        <div class="field"><span class="optional" data-optional-badge>任意</span><input aria-label="任意欄"></div></main>`)
      const excesses = () => page.evaluate(() => [...document.querySelectorAll('[data-required-badge],[data-optional-badge]')].map(el => {
        const range = document.createRange(); range.selectNodeContents(el)
        const style = getComputedStyle(el)
        return el.getBoundingClientRect().width - range.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      }))
      assert.ok((await excesses()).every(excess => Math.abs(excess) < 1), '札は文字と内側の幅だけを持つ')
      await page.addStyleTag({ content: 'html:root .field > .required{align-self:stretch}' })
      assert.ok((await excesses()).some(excess => excess > 100), '縦flexの伸びる故障を実寸で検出する')
    }
  } finally { await browser.close() }
})
