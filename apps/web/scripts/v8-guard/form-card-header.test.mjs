import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import collectFormHeaderInsets, { formHeaderFailures } from './form-card-header-browser.mjs'

test('入力のカードでは見出しと本文の余白を共有し、重なる故障を検出する', async () => {
  const css = readFileSync(new URL('../../src/components/shared/card.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.setContent(`<style>:root{--tpl-cn-card-pad:24px;--polish-space-card:24px;--polish-space-field:12px;--card-edge:#ddd;--radius-card:12px}*{box-sizing:border-box}input{width:100%}${css}</style><section class="card form" data-card-variant="form"><div class="header headerStacked" data-design-node="test"><div class="titleGroup"><h2 class="title">名前とフォルダ</h2></div></div><div><label>名前</label><input aria-label="名前" value="保持する名前"></div></section>`)
      const rows = await page.evaluate(collectFormHeaderInsets)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].difference, 0)
      assert.deepEqual(formHeaderFailures(rows), [])
      await page.locator('.header').evaluate(el => el.classList.remove('headerStacked'))
      assert.equal(formHeaderFailures(await page.evaluate(collectFormHeaderInsets)).length, 1)
      assert.equal(await page.getByLabel('名前').inputValue(), '保持する名前')
    }
  } finally { await browser.close() }
})
