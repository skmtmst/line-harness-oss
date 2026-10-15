import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'
import { listRowContentLines } from '../../src/components/shared/list-row-density.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const globals = read('../../src/app/globals.css')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('B-254: rendered content selects 52/60, general tables stay 56; incorrect markers fail', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const table = (id, list = false, template = false, content = '名前') => `<section ${list ? 'data-list-skeleton' : ''}><div class="frame" ${template ? 'data-table-presentation="template-list"' : ''}><table id="${id}" class="table"><tbody><tr class="row" data-shared-part="list-row"><td class="bodyCell">${content}</td></tr></tbody></table></div></section>`
    const columnTable = list => `<section ${list ? 'data-list-skeleton' : ''}><div class="frame" data-column-layout style="--table-row-height:var(--polish-table-row)"><table class="table"><tbody><tr class="row" data-table-layout="columns" data-shared-part="list-row"><td class="bodyCell">列型</td></tr></tbody></table></div></section>`
    const tables = table('general') + table('list', true) + table('template', true, true) + columnTable(false) + columnTable(true)
      + table('double', true, false, '名前<br>補足') + table('triple', true, false, '名前<br>補足<br>三行目')
    // 実画面のTailwind preflightと同じbox-sizingを含める。
    const html = (body, styles, broken = '') => `<html data-theme="v8"><style>${globals}\n* {box-sizing:border-box}\ntd {line-height:16px}\n${styles}\n${broken}</style><body>${body}</body></html>`
    const heights = selector => page.locator(selector).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height * 1000) / 1000))
    const setDensity = async () => {
      for (const row of await page.locator('[data-list-skeleton] tr, [data-list-skeleton] [data-shared-part="list-row"]').all()) {
        const lines = await row.evaluate(listRowContentLines)
        await row.evaluate((el, count) => { el.dataset.listContentLines = String(count) }, lines)
      }
    }
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(html(tables, css('data-table')))
      await setDensity()
      assert.deepEqual(await heights('tr'), [56, 52, 52, 56, 52, 60, 60])
      assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
      await page.locator('#double tr').evaluate(el => { el.dataset.listContentLines = '1' })
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-178 行60'), 'wrong single-line marker must fail independently')
      await page.setContent(html(tables, css('data-table'), "[data-theme='v8'] {--tpl-list-row-h:56px}"))
      await setDensity()
      assert.deepEqual(await heights('tr'), [56, 56, 56, 56, 56, 60, 60])
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-178 行52'))
      await page.setContent(html('<div class="table"><div class="row">一般表</div></div><section data-list-skeleton><div class="table"><div class="row" data-shared-part="list-row"><span>一覧</span></div><div class="row" data-shared-part="list-row"><span>名前<br>補足</span></div></div></section>', css('grid-table')))
      await setDensity()
      assert.deepEqual(await heights('.row'), [56, 52, 60])
      assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
      await page.setContent(html('<div class="listRow">一覧の読み込み中</div><div class="row">一般の骨格</div><section data-list-skeleton><div class="row">一覧の骨格</div></section>', css('skeleton')))
      assert.deepEqual(await heights('.listRow, .row'), [52, 56, 52])
      assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--tpl-mb-life-row-h').trim()), '60px')
    }
    await page.setContent(html(table('dynamic', true, false, '<span>名前</span><span class="sr-only">読み上げだけ<br>二行目</span><span hidden>隠した補足<br>二行目</span>'), css('data-table')))
    await setDensity()
    assert.deepEqual(await heights('tr'), [52])
    await page.locator('#dynamic td').evaluate(el => { el.innerHTML = '名前<br>補足' })
    await setDensity()
    assert.deepEqual(await heights('tr'), [60])
    await page.setContent(html(table('preview', true, false, '名前<span aria-hidden="true" style="display:block;width:64px;height:40px"></span>'), css('data-table')))
    await setDensity()
    assert.deepEqual(await heights('tr'), [60])
    assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
    // A wrapped text line also counts; side-by-side text in two cells does not.
    await page.setContent(html(table('wrapped', true, false, '<span style="display:block;width:24px;font:13px/16px sans-serif">AAA AAA AAA</span>') + '<section data-list-skeleton><div class="frame"><table class="table"><tbody><tr class="row"><td class="bodyCell">名前</td><td class="bodyCell"><span style="font-size:11px">状態</span></td></tr></tbody></table></div></section>', css('data-table')))
    await setDensity()
    assert.equal(await page.locator('#wrapped tr').evaluate(listRowContentLines), 3)
    assert.deepEqual(await heights('tr'), [60, 52])

    // Real GridTable uses ARIA table/row. The general 56px rule in globals
    // must not win when production CSS chunks load in a different order.
    const grids = '<div class="table" role="table"><div class="row" role="row"><span>一般表</span></div></div>'
      + '<section data-list-skeleton><div class="table" role="table"><div class="row" role="row" data-shared-part="list-row"><span>会員</span></div><div class="row" role="row" data-shared-part="list-row"><span>名前<br>補足</span></div></div></section>'
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      for (const orderedStyles of [`${globals}\n${css('grid-table')}`, `${css('grid-table')}\n${globals}`]) {
        await page.setContent(`<html data-theme="v8"><style>${orderedStyles}\n*{box-sizing:border-box}</style><body>${grids}</body></html>`)
        await setDensity()
        assert.deepEqual(await heights('.row'), [56, 52, 60], 'list density must win in both CSS orders')
        assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
      }
    }
  } finally { await browser.close() }
})
