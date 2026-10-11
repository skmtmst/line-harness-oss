import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { scanListSkeleton } from './list-skeleton-scan.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const globals = read('../../src/app/globals.css')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('本物の共通CSSで一覧60・一般表56を分け、一覧56への故障を検出する', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const table = (id, list = false, template = false) => `<section ${list ? 'data-list-skeleton' : ''}><div class="frame" ${template ? 'data-table-presentation="template-list"' : ''}><table id="${id}" class="table"><tbody><tr class="row" data-shared-part="list-row"><td class="bodyCell">名前</td></tr></tbody></table></div></section>`
    const columnTable = list => `<section ${list ? 'data-list-skeleton' : ''}><div class="frame" data-column-layout style="--table-row-height:var(--polish-table-row)"><table class="table"><tbody><tr class="row" data-table-layout="columns" data-shared-part="list-row"><td class="bodyCell">列型</td></tr></tbody></table></div></section>`
    const tables = table('general') + table('list', true) + table('template', true, true) + columnTable(false) + columnTable(true)
    // 実画面のTailwind preflightと同じbox-sizingを含める。
    const html = (body, styles, broken = '') => `<html data-theme="v8"><style>${globals}\n* {box-sizing:border-box}\n${styles}\n${broken}</style><body>${body}</body></html>`
    const heights = selector => page.locator(selector).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height * 1000) / 1000))
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(html(tables, css('data-table')))
      assert.deepEqual(await heights('tr'), [56, 60, 60, 56, 60])
      assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
      await page.setContent(html(tables, css('data-table'), "[data-theme='v8'] {--tpl-list-row-h:56px}"))
      assert.deepEqual(await heights('tr'), [56, 56, 56, 56, 56])
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-178 行60'))
      await page.setContent(html('<div class="row">一般表</div><section data-list-skeleton><div class="row" data-shared-part="list-row">一覧</div></section>', css('grid-table')))
      assert.deepEqual(await heights('.row'), [56, 60])
      assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
      await page.setContent(html('<div class="listRow">一覧の読み込み中</div><div class="row">一般の骨格</div><section data-list-skeleton><div class="row">一覧の骨格</div></section>', css('skeleton')))
      assert.deepEqual(await heights('.listRow, .row'), [60, 56, 60])
      assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--tpl-mb-life-row-h').trim()), '60px')
    }
  } finally { await browser.close() }
})
