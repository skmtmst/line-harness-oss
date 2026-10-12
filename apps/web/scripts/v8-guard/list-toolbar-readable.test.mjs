import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { fitListSearchPlaceholder } from '../../src/components/shared/search-field-size.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'
import { fitListColumns } from '../../src/components/shared/list-column-sizing.mjs'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('B-191: list placeholders remain readable at both widths; fixed-width regression is detected', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      for (const placeholder of ['ルール名・言葉で探す', '成果地点の名前で探す', '名前・本文・差し込みで探す']) {
        await page.setContent(`<html data-theme="v8"><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n${css('search-field').replaceAll('.searchIcon', '.controlIcon').replaceAll('.search', '.controlSearch').replaceAll('.input', '.controlInput')}\n*{box-sizing:border-box} .toolbar{width:800px}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar><div class="row1"><div class="search" data-toolbar-search style="--list-search-width:160px"><div class="controlSearch"><svg style="width:16px;height:16px;flex:none"></svg><input type="search" class="controlInput" placeholder="${placeholder}"></div></div></div></div></section></html>`)
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

test('list columns give spare width to the name and remeasure changed data', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const columns of [false, true]) {
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('data-table')}\n*{box-sizing:border-box} .frame{width:700px} table{width:100%;table-layout:fixed} tr{height:52px} th,td{padding:0 8px;font:13px sans-serif} th:nth-child(2),td:nth-child(2){width:200px} th:nth-child(3),td:nth-child(3){width:160px} ${columns ? 'table,thead,tbody{display:block} tr{display:flex} th:first-child,td:first-child{flex:1 1 0}' : ''}</style><div class="frame" data-column-sizing="content"><table class="table"><thead><tr ${columns ? 'data-table-layout="columns"' : ''}><th>名前</th><th>追加先</th><th>操作</th></tr></thead><tbody><tr ${columns ? 'data-table-layout="columns"' : ''}><td data-cell-grow><span data-list-name>Google広告 夏キャンペーン</span></td><td><span>—</span></td><td><button style="width:36px;height:36px">…</button></td></tr></tbody></table></div></html>`)
      const width = () => page.locator('tbody td').first().evaluate(el => el.getBoundingClientRect().width)
      const before = await width()
      await page.locator('.frame').evaluate(fitListColumns)
      assert.ok(await width() > before + 100, 'short secondary values must release their spare width')
      const small = await page.locator('tbody td').nth(1).evaluate(el => el.getBoundingClientRect().width)
      await page.locator('tbody td').nth(1).evaluate(el => { el.firstElementChild.textContent = '未設定のアカウント' })
      await page.locator('.frame').evaluate(fitListColumns)
      const grown = await page.locator('tbody td').nth(1).evaluate(el => el.getBoundingClientRect().width)
      assert.ok(grown > small, `new content must grow back within its original budget (columns=${columns}, ${small}→${grown})`)
      assert.equal(await page.locator('button').evaluate(el => el.getBoundingClientRect().width), 36)
      assert.equal(await page.locator('td[data-cell-grow]').innerText(), 'Google広告 夏キャンペーン')
    }
  } finally { await browser.close() }
})
