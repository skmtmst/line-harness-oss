import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { fitListSearchPlaceholder } from '../../src/components/shared/search-field-size.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'
import { fitListColumns } from '../../src/components/shared/list-column-sizing.mjs'
import { toolbarContentFit, fitToolbarWrap } from '../../src/components/shared/list-toolbar-fit.mjs'
import { fitSelectContent } from '../../src/components/shared/select-content-size.mjs'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('B-191: list placeholders remain readable at both widths; fixed-width regression is detected', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      for (const placeholder of ['ルール名・言葉で探す', '成果地点の名前で探す', '名前・本文・差し込みで探す']) {
        await page.setContent(`<html data-theme="v8"><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n${css('search-field').replaceAll('.searchIcon', '.controlIcon').replaceAll('.search', '.controlSearch').replaceAll('.input', '.controlInput')}\n*{box-sizing:border-box} .toolbar{width:800px}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar><div class="row1" data-toolbar-tools><div class="search" data-toolbar-search style="--list-search-width:160px"><div class="controlSearch"><svg style="width:16px;height:16px;flex:none"></svg><input type="search" class="controlInput" placeholder="${placeholder}"></div></div></div></div></section></html>`)
        await page.evaluate(() => document.fonts.ready)
        assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-191 探す欄の見本文字切れ'))
        await page.locator('input').evaluate(fitListSearchPlaceholder)
        assert.deepEqual((await page.evaluate(scanListSkeleton)).failures, [])
        await page.locator('.toolbar').evaluate(el => { const optional = document.createElement('details'); optional.className = 'optional'; el.append(optional) })
        assert.equal(await page.locator('[data-toolbar-search]').evaluate(el => getComputedStyle(el).flexShrink), '1', 'optional tools must not restore the old flex:none search')
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
      await page.locator('tbody td').nth(1).evaluate(el => { el.innerHTML = '<span data-design-node="xRvDB" class="badge"><span style="display:block;overflow:hidden;text-overflow:ellipsis">計測済</span></span>' })
      await page.addStyleTag({ content: '.badge{display:inline-flex;padding:2px 8px;gap:8px;max-width:100%}.badge::before{content:"";width:6px;height:6px;flex:none}' })
      await page.locator('.frame').evaluate(fitListColumns)
      const badge = await page.locator('.badge > span').evaluate(el => ({ available: el.clientWidth, required: el.scrollWidth }))
      assert.ok(badge.available >= badge.required, 'the pseudo-element dot and its gap must not consume the label width')
      await page.locator('tbody td').nth(2).evaluate(el => { el.innerHTML = '<div style="display:flex;gap:8px"><button style="width:84px;height:32px;flex:none">登録する</button><button style="width:36px;height:36px;flex:none">…</button></div>' })
      await page.locator('.frame').evaluate(fitListColumns)
      const ops = await page.locator('tbody td').nth(2).evaluate(el => ({ available: el.clientWidth, required: el.scrollWidth }))
      assert.ok(ops.available >= ops.required, 'primary action and menu both keep their hit areas')
    }
  } finally { await browser.close() }
})

test('content-sized list selects stay readable; real band width decides chip collapse', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('select')}\n*{box-sizing:border-box} .band{display:flex;gap:8px;width:800px} .row{display:contents} .search{flex:0 1 240px;min-width:180px;--list-search-content-min:180px} .chips{width:400px;flex:none} .count{width:100px;flex:none}</style><section data-list-skeleton><div class="band" data-list-toolbar><div class="row"><div class="search" data-toolbar-search>検索</div><span class="chips" data-filter-width="400">状態</span><div class="content root"><button class="trigger"><span class="value" data-select-value>並び：件数が多い順</span><svg class="chevron"></svg></button></div><div class="count">件数</div></div></div></section></html>`)
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-178 道具のはみ出し'))
    assert.equal((await page.locator('.band').evaluate(toolbarContentFit)).fits, false)
    await page.locator('.count').evaluate(el => { el.style.flexGrow = '1' })
    assert.equal((await page.locator('.band').evaluate(toolbarContentFit)).fits, false, 'a growing real control must still be counted')
    await page.locator('.count').evaluate(el => { el.style.flexGrow = '0' })
    await page.locator('.band').evaluate(el => { el.style.width = '1000px' })
    assert.equal((await page.locator('.band').evaluate(toolbarContentFit)).fits, true)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-191 選ぶ欄の文字切れ'))
    await page.locator('.root').evaluate(el => { el.className = 'standard root'; el.style.width = '100px' })
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-191 選ぶ欄の文字切れ'))
    await page.locator('.root').evaluate(el => { el.className = 'content root'; el.style.width = '' })
    await page.locator('.root').evaluate(fitSelectContent)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-191 選ぶ欄の文字切れ'))
  } finally { await browser.close() }
})

test('a notice owns its full row; a zero-width tool band with clipped controls fails', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}</style><section data-list-skeleton data-template-region="toolbar"><div class="slots" data-list-toolbar data-toolbar-layout="slots" style="width:800px"><div data-design-part="notice">案内</div><div class="toolbar" data-list-toolbar data-toolbar-layout="band"><button style="width:100px;flex:none">探す</button></div></div></section></html>`)
    assert.ok(await page.locator('.toolbar').evaluate(el => el.getBoundingClientRect().width) > 100)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-178 道具の幅0'))
    await page.locator('.slots').evaluate(el => el.style.setProperty('flex-wrap', 'nowrap', 'important'))
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('B-178 道具の幅0'))
  } finally { await browser.close() }
})

test('collapsed controls still wrap when their minimum widths cannot fit and return to one row', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}button{flex:none;width:150px;height:36px}</style><section data-list-skeleton><div class="slots" data-list-toolbar data-toolbar-layout="slots" style="width:852px"><div class="slotsRow"><button>作る</button><button>フォルダ</button><div class="searchSlot" data-toolbar-search style="--list-search-content-min:190px;--list-search-width:280px">検索</div><button>並び</button><button>件数</button><span class="filterChoices" data-filter-width="460"><button>状態</button></span></div></div></section></html>`)
    await page.addScriptTag({ content: toolbarContentFit.toString() })
    await page.locator('.slots').evaluate(fitToolbarWrap)
    assert.equal(await page.locator('.slots').getAttribute('data-toolbar-fit'), 'wrap')
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-178 道具のはみ出し'))
    await page.locator('.slots').evaluate(el => { el.style.width = '1200px' })
    await page.locator('.slots').evaluate(fitToolbarWrap)
    assert.equal(await page.locator('.slots').getAttribute('data-toolbar-fit'), 'single')
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-178 道具のはみ出し'))
  } finally { await browser.close() }
})

test('a requested secondary toolbar stays on its own row even when the primary controls fit', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar data-toolbar-layout="band" data-toolbar-fit="single" style="width:800px"><button style="width:200px;flex:none">検索</button><div class="secondary" data-toolbar-secondary><button style="width:300px;flex:none">並び</button></div></div></section></html>`)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-178 道具のはみ出し'))
    const positions = await page.locator('button').evaluateAll(es => es.map(e => e.getBoundingClientRect().y))
    assert.ok(positions[1] > positions[0], 'an explicit second section is not counted as a first-row tool')
  } finally { await browser.close() }
})
