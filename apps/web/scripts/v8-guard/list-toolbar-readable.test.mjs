import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { fitListSearchPlaceholder } from '../../src/components/shared/search-field-size.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('B-191: list placeholders remain readable at both widths; fixed-width regression is detected', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      for (const placeholder of ['ルール名・言葉で探す', '成果地点の名前で探す', '名前・本文・差し込みで探す']) {
        await page.setContent(`<html data-theme="v8"><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n${css('search-field')}\n*{box-sizing:border-box} .toolbar{width:800px}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar><div class="row1"><div class="searchSlot" data-toolbar-search style="--list-search-width:160px"><div class="search"><svg style="width:16px;height:16px;flex:none"></svg><input type="search" class="input" placeholder="${placeholder}"></div></div></div></div></section></html>`)
        await page.evaluate(() => document.fonts.ready)
        assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-191 探す欄の見本文字切れ'))
        await page.locator('input').evaluate(fitListSearchPlaceholder)
        assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
        await page.locator('[data-toolbar-search]').evaluate(el => { el.style.setProperty('min-width', '160px', 'important'); el.style.setProperty('flex-basis', '160px', 'important') })
        assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-191 探す欄の見本文字切れ'))
      }
    }
  } finally { await browser.close() }
})
