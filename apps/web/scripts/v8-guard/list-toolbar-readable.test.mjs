import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { fitListSearchPlaceholder } from '../../src/components/shared/search-field-size.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'
import { fitListColumns } from '../../src/components/shared/list-column-sizing.mjs'
import { toolbarContentFit, fitToolbarWrap, fitToolbarOptionalWidth } from '../../src/components/shared/list-toolbar-fit.mjs'
import { fitSelectContent } from '../../src/components/shared/select-content-size.mjs'
import scanFixPatterns from './fix-patterns-browser.mjs'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('KPI filtering and navigation actions have the same line height; a normal button minimum stretches the band', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const card = action => `<div class="card" data-kpi-presentation="band"><div class="head"><p class="label">空のまま使われている</p></div><p class="value"><span class="number">1</span><span class="unit">件</span></p><p class="detail"><span class="detailText">空欄のまま送られます</span>${action}</p></div>`
    await page.setContent(`<html data-theme="v8"><style>${read('../../src/app/globals.css')}\n${css('kpi-card')}</style><main><div class="strip" data-kpi-presentation="band">${card('<a class="link" href="/history">詳しく見る</a>')}${card('<button class="link" type="button">編集する</button>')}</div></main></html>`)
    const heights = () => page.locator('.detail').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height))
    const [link, button] = await heights()
    assert.equal(button, link, 'filtering must not change the KPI band height')
    await page.locator('button.link').evaluate(el => el.style.minHeight = '32px')
    const [unchanged, stretched] = await heights()
    assert.equal(unchanged, link)
    assert.ok(stretched > button, 'the old minimum must expose the height regression')
  } finally { await browser.close() }
})

test('a compact registration action keeps the existing one-line row height; a tall action expands it', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html data-theme="v8"><style>${read('../../src/app/globals.css')}\n${css('button')}\ntable{border-collapse:collapse}tr{height:52px}td{padding:0}</style><table><tbody><tr><td>登録済みの経路</td></tr><tr><td><button class="button secondary compact" data-row-quick-action>登録する</button></td></tr></tbody></table></html>`)
    const heights = () => page.locator('tr').evaluateAll(rows => rows.map(el => el.getBoundingClientRect().height))
    assert.deepEqual(await heights(), [52, 52])
    assert.equal(await page.locator('button').evaluate(el => el.getBoundingClientRect().height), 32)
    await page.locator('button').evaluate(el => el.style.height = '64px')
    const [registered, oversized] = await heights()
    assert.equal(registered, 52)
    assert.ok(oversized > registered)
  } finally { await browser.close() }
})

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

test('page size wrappers use the same readable width as their control', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n${css('select')}\n*{box-sizing:border-box}.oldCount{width:96px}.toolbar{width:300px}.trigger{height:36px}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar><div class="trailing"><div class="oldCount" data-per-page-select><div class="root content"><button class="trigger" aria-haspopup="listbox"><span class="value" data-select-value>50 件表示</span><svg class="chevron"></svg></button></div></div></div></div></section></html>`)
    await page.locator('.root').evaluate(fitSelectContent)
    const sizes = await page.locator('[data-per-page-select]').evaluate(el => ({ wrapper: el.getBoundingClientRect().width, control: el.querySelector('button').getBoundingClientRect().width }))
    assert.ok(sizes.wrapper >= sizes.control)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('B-191 選ぶ欄の文字切れ'))
    await page.locator('[data-per-page-select]').evaluate(el => { el.style.width = '96px'; el.style.minWidth = '0' })
    const broken = await page.locator('[data-per-page-select]').evaluate(el => el.getBoundingClientRect().width < el.querySelector('button').getBoundingClientRect().width)
    assert.equal(broken, true)
  } finally { await browser.close() }
})

test('U1: timestamps stay on one line and their columns reserve the full current or previous year', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const flex of [false, true]) {
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('data-table')}\n${css('list-date-time')}\n*{box-sizing:border-box}.frame{width:700px}table{table-layout:fixed;width:100%}td,th{font:12px sans-serif;padding:0 8px} ${flex ? 'table,thead,tbody{display:block}tr{display:flex}td:first-child,th:first-child{flex:1 1 0}td:last-child,th:last-child{width:72px}' : ''}</style><div class="frame" data-column-sizing="content"><table class="table">${flex ? '' : '<colgroup><col><col style="width:72px"></colgroup>'}<thead><tr ${flex ? 'data-table-layout="columns"' : ''}><th>名前</th><th>更新</th></tr></thead><tbody><tr ${flex ? 'data-table-layout="columns"' : ''}><td data-cell-grow>夏のキャンペーン</td><td><span class="timestamp" data-list-date-time><span>09/30</span> <span>14:12</span></span></td></tr></tbody></table></div></html>`)
      const check = () => page.locator('[data-list-date-time]').evaluate(el => {
        const a = el.firstElementChild.getBoundingClientRect(), b = el.lastElementChild.getBoundingClientRect(), cell = el.closest('td'), c = getComputedStyle(cell)
        return { oneLine: Math.abs(a.y - b.y) < 1, gap: b.x - a.right, fits: el.getBoundingClientRect().width <= cell.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight) + 1 }
      })
      await page.locator('.frame').evaluate(fitListColumns)
      assert.deepEqual(await check(), { oneLine: true, gap: 4, fits: true })
      await page.locator('.timestamp span').first().evaluate(el => el.textContent = '2025/10/01')
      await page.locator('.frame').evaluate(fitListColumns)
      assert.deepEqual(await check(), { oneLine: true, gap: 4, fits: true })
      await page.locator('.timestamp').evaluate(el => { el.style.flexWrap = 'wrap'; el.style.width = '48px' })
      assert.equal((await check()).oneLine, false, 'the former wrap must expose the regression')
    }
  } finally { await browser.close() }
})

test('U4: a sort keeps its visible current value; hiding it behind an icon is detected', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n${css('select')}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar><span data-list-sort><div class="root content"><button class="trigger" aria-haspopup="listbox"><span class="value" data-select-value>並び：新しい順</span></button></div></span></div></section></html>`)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('U4 並びの現在値なし'))
    await page.locator('[data-select-value]').evaluate(el => el.style.visibility = 'hidden')
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('U4 並びの現在値なし'))
    await page.locator('[data-select-value]').evaluate(el => { el.style.visibility = ''; el.style.color = 'transparent' })
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('U4 並びの現在値なし'))
  } finally { await browser.close() }
})

test('U5: optional controls reserve the overflowing readable width and keep the adjacent control gap', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}button{height:36px;flex:none}</style><section data-list-skeleton><div class="toolbar" data-list-toolbar><span class="optional" data-toolbar-optional><span data-toolbar-optional-content><div style="width:150px"><button style="width:177px">報酬の決め方：すべて</button></div></span></span><button style="width:90px">計測中</button></div></section></html>`)
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('U5 道具の重なり'))
      await page.locator('[data-toolbar-optional]').evaluate(fitToolbarOptionalWidth)
      const gap = await page.locator('.toolbar').evaluate(el => { const [a,b] = [...el.querySelectorAll('button')].map(e=>e.getBoundingClientRect());return b.x-a.right })
      assert.equal(gap, 8)
      assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('U5 道具の重なり'))
      await page.locator('[data-toolbar-optional]').evaluate(el => el.style.setProperty('--toolbar-optional-width', '150px'))
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('U5 道具の重なり'))
    }
  } finally { await browser.close() }
})

test('U6/V3: full KPI notes wrap, actions get their next line and the strip keeps equal cells', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const card = (detail, action='') => `<div class="card" data-design-version="v8" data-kpi-presentation="band"><div class="head"><p class="label">未設定</p></div><p class="value"><span class="number" data-kpi-number>2</span></p><p class="detail" data-kpi-detail data-kpi-detail-present><span class="detailText" role="note">${detail}</span>${action}</p></div>`
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('kpi-card')}\n${read('../../src/components/shared/kpi-band-v8.css')}\n*{box-sizing:border-box}</style><section data-list-skeleton style="width:520px"><div class="strip" data-kpi-strip data-kpi-presentation="band">${card('友だちになっても何も起きない', '<button type="button" class="link">未設定を見る</button>')}${card('「やり取りの記録」からやり直せます')}${card('空欄のまま送られます', '<a class="link" href="/edit">編集する</a>')}</div></section></html>`)
      const failures = (await page.evaluate(scanListSkeleton)).failures
      assert.ok(!failures.includes('U6 数の補足の切れ'))
      assert.ok(!failures.includes('U6 数の行き先が同じ行'))
      const heights = await page.locator('.card').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height))
      assert.ok(heights.every(h=>h===heights[0]))
      await page.locator('button.link').evaluate(el=>el.addEventListener('click',()=>el.dataset.clicked='yes'))
      await page.locator('button.link').click()
      assert.equal(await page.locator('button.link').getAttribute('data-clicked'), 'yes')
      assert.equal(await page.locator('a.link').getAttribute('href'), '/edit')
      await page.locator('[role="note"]').first().evaluate(el=>{el.style.whiteSpace='nowrap';el.style.overflow='hidden';el.style.textOverflow='ellipsis'})
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('U6 数の補足の切れ'))
    }
  } finally { await browser.close() }
})

test('V1: readable stacked rows keep the count in the last row on the right; upper and left counts fail', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}button{height:36px;width:100px;flex:none}</style><section data-list-skeleton style="width:852px"><div class="slots" data-list-toolbar data-toolbar-layout="slots-stacked"><div class="slotsRow" data-toolbar-row data-toolbar-fit="single"><button>作る</button><button>探す</button></div><div class="slotsRow" data-toolbar-row data-toolbar-fit="single"><button>絞り込む</button><span class="slotsEnd" data-toolbar-end><span data-list-page-size><button>20件表示</button></span></span></div></div></section></html>`)
    assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes('V1 件数は最後の道具行の右'))
    assert.equal(await page.locator('[data-toolbar-row]').first().evaluate(el => getComputedStyle(el).flexWrap), 'nowrap')
    assert.equal(await page.locator('[data-toolbar-row]').first().evaluate(el => el.getBoundingClientRect().height), 36)
    await page.locator('[data-toolbar-end]').evaluate(el => { el.style.marginLeft='0' })
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('V1 件数は最後の道具行の右'))
    await page.locator('[data-toolbar-end]').evaluate(el => { el.style.marginLeft='';el.closest('.slots').firstElementChild.append(el) })
    assert.ok((await page.evaluate(scanListSkeleton)).failures.includes('V1 件数は最後の道具行の右'))
  } finally { await browser.close() }
})

test('V2: a collapsed folder reserves its readable selected width instead of a fixed narrow wrapper', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    const templateCss = read('../../src/components/templates/page-templates.module.css').replace(/:global\(([^)]+)\)/g, '$1')
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${templateCss}\n${css('select')}\n*{box-sizing:border-box}.tools{display:flex;gap:8px;width:852px}</style><div class="tools"><span class="collapsedSelect"><div class="root content" style="--list-select-content-width:240px"><button class="trigger" aria-haspopup="listbox"><span class="value" data-select-value>フォルダ：渋谷エリアのご案内</span><svg class="chevron"></svg></button></div></span><button>探す</button></div></html>`)
    const fit = () => page.locator('.collapsedSelect').evaluate(el => el.getBoundingClientRect().width >= el.querySelector('button').getBoundingClientRect().width)
    assert.equal(await fit(), true)
    await page.locator('.collapsedSelect').evaluate(el => { el.style.width='150px';el.style.minWidth='0' })
    assert.equal(await fit(), false, 'the former narrow wrapper must be exposed')
  } finally { await browser.close() }
})

test('F6: KPI necessary height follows painted lines with fixed spacing, forced height and padding fail', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const markup = note => `<html><style>${read('../../src/app/globals.css')}\n${css('kpi-card')}\n${read('../../src/components/shared/kpi-band-v8.css')}\n*{box-sizing:border-box}p{margin:0}</style><section data-list-skeleton style="width:700px"><div data-kpi-strip data-kpi-presentation="band"><div class="card" data-design-version="v8" data-kpi-presentation="band"><div class="head"><p class="label">件数</p></div><div class="valueRow"><p class="value"><span class="number" data-kpi-number>2</span></p></div><p class="detail" data-kpi-detail data-kpi-detail-present><span class="detailText" role="note">${note}</span></p></div></div></section></html>`
    const rule = 'B-178 数の帯の共通余白と必要高'
    for (const [note, expected] of [['補足',116], ['補足<br>二行目',134], ['補足<br>二行目<br>三行目',152]]) {
      await page.setContent(markup(note))
      assert.equal(await page.locator('.card').evaluate(el => el.getBoundingClientRect().height), expected)
      assert.ok(!(await page.evaluate(scanListSkeleton)).failures.includes(rule))
      await page.locator('.card').evaluate(el => el.style.height='220px')
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes(rule))
      await page.locator('.card').evaluate(el => { el.style.height=''; el.style.paddingTop='24px' })
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes(rule))
      await page.locator('.card').evaluate(el => { el.style.paddingTop=''; el.querySelector('[data-kpi-detail]').style.minHeight='80px' })
      assert.ok((await page.evaluate(scanListSkeleton)).failures.includes(rule))
    }
  } finally { await browser.close() }
})

test('F6: all list pagers own one layer of padding, including lists without skeleton markers', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const templateCss = read('../../src/components/templates/page-templates.module.css').replace(/:global\(([^)]+)\)/g, '$1')
    for (const skeleton of [false,true]) {
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${templateCss}\n*{box-sizing:border-box}button{height:32px}</style><div class="listBody" ${skeleton?'data-list-skeleton':''}><div class="pagination"><div class="pagination"><div class="paginationRow"><span>1件中 1〜1件</span><nav><button>1</button></nav></div></div></div></div></html>`)
      assert.equal(await page.locator('.pagination').first().evaluate(el => el.getBoundingClientRect().height), 56)
      assert.equal(await page.locator('.pagination .pagination').evaluate(el => getComputedStyle(el).padding), '0px')
      await page.locator('.pagination .pagination').evaluate(el => el.style.padding='12px 24px')
      assert.equal(await page.locator('.pagination').first().evaluate(el => el.getBoundingClientRect().height), 80)
    }
  } finally { await browser.close() }
})

test('F1/F6: stacked state badges keep their text and the 60px row with common spacing', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('data-table')}\n${css('status-badge')}\n*{box-sizing:border-box}table{width:700px}tr{height:60px}</style><section data-list-skeleton><table><tbody><tr class="row" data-shared-part="list-row"><td class="bodyCell">名前</td><td class="bodyCell statusCell"><div class="statusStack"><span class="badge success">公開中</span><span class="badge danger compact">後処理の未完 2</span></div></td></tr></tbody></table></section></html>`)
    assert.equal(await page.locator('tr').evaluate(el => Math.round(el.getBoundingClientRect().height)), 60)
    assert.equal(await page.locator('.statusStack').evaluate(el => getComputedStyle(el).gap), '4px')
    assert.equal(await page.locator('.badge').nth(1).innerText(), '後処理の未完 2')
    await page.locator('.statusCell').evaluate(el => el.style.paddingBlock='12px')
    assert.ok(await page.locator('tr').evaluate(el => el.getBoundingClientRect().height) > 60)
  } finally { await browser.close() }
})

test('F10: stacked callers share two narrow rows; a separate leading row fails and named overflow keeps tools usable', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({viewport:{width:1152,height:900}})
    await page.setContent(`<html><style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}button,input{height:36px;flex:none}.wideCreate{width:100%}</style><section data-page-template="list" data-list-skeleton style="width:852px;container-type:inline-size;container-name:v8-page"><div class="slots" data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout="slots-stacked"><span class="leading" data-toolbar-leading><a class="wideCreate">送り先を作る</a><button style="width:150px">フォルダ：すべて</button></span><span class="rowBreak"></span><div class="slotsRow" data-toolbar-row><span class="slotTool" data-toolbar-role="search"><div class="searchSlot" data-toolbar-search><input type="search" placeholder="名前で探す"></div></span><span class="slotTool" data-toolbar-role="filter"><details class="optional" data-toolbar-optional data-collapsed><summary>配信日・検索条件</summary><div data-toolbar-optional-content><input aria-label="配信日" type="date"><button>条件を保存する</button></div></details></span></div><div class="slotsRow" data-toolbar-row><span class="slotTool" data-toolbar-role="filter"><button>状態：すべて</button></span><span class="slotTool" data-toolbar-role="count"><span data-list-page-size><button>20件表示</button></span></span></div></div></section></html>`)
    await page.locator('.slots').evaluate(el => el.style.setProperty('--toolbar-leading-width',`${el.querySelector('[data-toolbar-leading]').getBoundingClientRect().width}px`))
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F10,0)
    const heights = await page.locator('[data-toolbar-leading]').evaluate(el=>[...el.children].map(c=>c.getBoundingClientRect().y))
    assert.equal(heights[0],heights[1])
    assert.equal(await page.locator('summary').evaluate(el=>getComputedStyle(el).fontSize),'13px')
    await page.locator('summary').click()
    await page.locator('input[type="date"]').fill('2026-10-12')
    assert.equal(await page.locator('input[type="date"]').inputValue(),'2026-10-12')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F10,0,'popover fields do not create a third toolbar row')
    await page.locator('summary').click()
    await page.addStyleTag({content:'.slots{flex-direction:column!important}.slots>.slotsRow{display:flex!important;width:100%}'})
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F10>0)
  } finally { await browser.close() }
})

test('named overflow measures its tools, not free space reserved for the rightmost action', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>${read('../../src/app/globals.css')}\n${css('list-toolbar')}\n*{box-sizing:border-box}button{height:36px;flex:none}</style><div class="toolbar" style="width:800px"><button style="width:200px">検索</button><details class="optional" data-toolbar-optional data-toolbar-overflow-group open><summary>条件</summary><div data-toolbar-optional-content><button style="width:160px">配信日</button><button style="width:140px">保存する</button><span class="slotsEnd"><button style="width:120px">保存した検索</button></span></div></details></div>`)
    assert.equal(await page.locator('details').evaluate(fitToolbarOptionalWidth),436)
    assert.equal((await page.locator('.toolbar').evaluate(toolbarContentFit)).fits,true)
    await page.locator('.toolbar').evaluate(el=>el.style.width='740px')
    assert.equal(await page.locator('details').evaluate(fitToolbarOptionalWidth),436)
    assert.equal((await page.locator('.toolbar').evaluate(toolbarContentFit)).fits,true)
    await page.locator('.toolbar').evaluate(el=>el.style.width='500px')
    assert.equal((await page.locator('.toolbar').evaluate(toolbarContentFit)).fits,false)
  } finally { await browser.close() }
})
