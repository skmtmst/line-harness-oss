import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import { fitListColumns } from '../../src/components/shared/list-column-sizing.mjs'
import scanColumns from './table-column-alignment-browser.mjs'
import scanLayout from './layout-defects-browser.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = path => read(path).replace(/:global\(([^)]+)\)/g, '$1')

test('record tracks align all four columns and detect the former stacked layout at every desktop width', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}${css('../../src/components/shared/data-table.module.css')}${css('../../src/components/shared/table.module.css')}
        *{box-sizing:border-box}.frame{width:calc(100vw - 660px)}.badge{display:inline-flex;padding:2px 8px;white-space:nowrap}td[data-cell-grow]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        </style><main><div class="frame" data-table-density="records" data-column-sizing="content" style="--table-columns:repeat(4,minmax(0,1fr))"><table class="table" aria-label="同期の記録"><thead><tr class="headRow"><th class="cell">日時</th><th class="cell">きっかけ</th><th class="cell" data-cell-grow>書き出したもの</th><th class="cell">結果</th></tr></thead><tbody>${['9/30 03:00', '9/29 15:42'].map(date => `<tr class="row"><td class="bodyCell">${date}</td><td class="bodyCell">定期</td><td class="bodyCell" data-cell-grow>友だち 1,284・フォーム回答 312</td><td class="bodyCell"><span class="badge" data-design-node="xRvDB">一部だけ完了</span></td></tr>`).join('')}</tbody></table></div></main></html>`)
      await page.locator('.frame').evaluate(fitListColumns)
      const good = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('tr')].map(row => [...row.children].map(cell => {
          const box = cell.getBoundingClientRect()
          return { x: box.x, width: box.width, top: box.top, bottom: box.bottom }
        }))
        return { rows, overflow: document.documentElement.scrollWidth - innerWidth }
      })
      const alignment = await page.evaluate(scanColumns)
      assert.equal(alignment.findings.length, 0)
      assert.equal(alignment.coverage[0].rows, 3, 'head and both data rows must actually be measured')
      assert.equal(good.overflow, 0)
      for (const row of good.rows.slice(1)) for (const [index, cell] of row.entries()) {
        assert.ok(Math.abs(cell.x - good.rows[0][index].x) < 1, JSON.stringify({ width, good }))
        assert.ok(Math.abs(cell.width - good.rows[0][index].width) < 1)
      }
      for (let repeat = 0; repeat < 5; repeat++) await page.locator('.frame').evaluate(fitListColumns)
      assert.equal((await page.evaluate(scanColumns)).findings.length, 0)
      await page.locator('.frame').evaluate(frame => {
        frame.style.removeProperty('--table-columns')
        frame.style.removeProperty('--table-content-columns')
      })
      assert.ok((await page.evaluate(scanColumns)).findings.length > 0, 'the missing-track fault must be detected')
    }
  } finally { await browser.close() }
})


test('late calendar data refreshes flex column widths and keeps every row aligned', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>${read('../../src/app/globals.css')}${css('../../src/components/shared/data-table.module.css')}${css('../../src/components/shared/table.module.css')}
        *{box-sizing:border-box}.frame{width:calc(100vw - 280px)}.table tr{display:flex}.table tr>th,.table tr>td{flex:0 1 auto;white-space:nowrap}.calendar{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        </style><main><div class="frame" data-column-layout data-column-sizing="content" style="--table-column-gap:12px;--table-column-padding:0 24px;--table-head-padding:0 24px;--table-head-height:40px;--table-row-height:56px"><table class="table"><thead><tr data-table-layout="columns"><th data-cell-grow>スタッフ</th><th>カレンダー</th><th>状態</th></tr></thead><tbody>${['高田 誠', '中川 由美'].map(name => `<tr data-table-layout="columns"><td data-cell-grow>${name}</td><td><span class="calendar">—</span></td><td>つながっている</td></tr>`).join('')}</tbody></table></div></main>`)
      await page.locator('.frame').evaluate(fitListColumns)
      const before = await page.locator('tbody tr').first().locator('td').nth(1).evaluate(cell => cell.getBoundingClientRect().width)
      await page.locator('tbody .calendar').evaluateAll(nodes => nodes.forEach(node => { node.textContent = 'takada@nen-salon.jp' }))
      await page.locator('.frame').evaluate(fitListColumns)
      const after = await page.locator('tbody tr').first().locator('td').nth(1).evaluate(cell => cell.getBoundingClientRect().width)
      assert.ok(after > before, `late value must grow its column: ${before} -> ${after}`)
      const clipping = await page.locator('tbody .calendar').evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth + 1))
      assert.equal(clipping, false, `calendar is readable at ${width}`)
      const positions = await page.locator('tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.getBoundingClientRect().x)))
      for (const row of positions.slice(1)) for (const [index, x] of row.entries()) assert.ok(Math.abs(x - positions[0][index]) <= 1)
      for (let repeat = 0; repeat < 3; repeat++) await page.locator('.frame').evaluate(fitListColumns)
      assert.equal(await page.locator('tbody tr').first().locator('td').nth(1).evaluate(cell => cell.getBoundingClientRect().width), after)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    }
  } finally { await browser.close() }
})

test('内容幅の表は長い名前の列を縮めても日付・数値・リンクの読み取り幅を守る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
    await page.setContent('<style>*{box-sizing:border-box}main{width:500px}table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{padding:0 8px;font:14px Arial}span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><main><div class="frame" data-column-sizing="content"><table><thead><tr><th>日時</th><th>件数</th><th data-cell-grow>担当者</th><th>操作</th></tr></thead><tbody><tr><td><span data-list-date-time>2026/10/26 23:59</span></td><td data-list-number>12,345</td><td data-cell-grow><span>long.member.name@example-company.test</span></td><td><a href="#">詳しく見る</a></td></tr><tr><td><span data-list-date-time>2026/10/25 18:30</span></td><td data-list-number>9,876</td><td data-cell-grow><span>another.long.name@example-company.test</span></td><td><a href="#">詳しく見る</a></td></tr></tbody></table></div></main>')
    await page.locator('.frame').evaluate(fitListColumns)
    const protectedCells = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.children].slice(0, 2).map(cell => ({ width: cell.getBoundingClientRect().width, scroll: cell.scrollWidth, client: cell.clientWidth }))))
    for (const row of protectedCells) for (const cell of row) assert.ok(cell.width > 0 && cell.client >= cell.scroll - 1, JSON.stringify({ row, protectedCells }))
    const email = await page.locator('tbody tr:first-child td:nth-child(3) span').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }))
    assert.ok(email.scroll > email.client, 'long text may be ellipsized in the flexible name cell')
  } finally { await browser.close() }
})

test('内容に合わせてメールを広げ、短い状態列を縮める。固定の等分割の故障は見つかる', async () => {
  const { fitGridContentColumns } = await import('../../src/components/shared/grid-content-columns.mjs')
  const scanOwner = (await import('./owner-rules-browser.mjs')).default
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1024, 1152, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent('<style>*{box-sizing:border-box}.table{width:calc(100vw - 280px);font:14px Arial}.row{display:grid;grid-template-columns:var(--grid-table-content-columns,repeat(4,minmax(0,1fr)));gap:16px;padding:0 24px}.text{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><main><div class="table" role="table"><div class="row" role="row"><span role="columnheader">名前</span><span role="columnheader">メールアドレス</span><span role="columnheader">状態</span><span role="columnheader">最終ログイン</span></div><div class="row" role="row"><span>担当者</span><span><span class="text" title="long.member.name@example-company.test">long.member.name@example-company.test</span></span><span>有効</span><span>10/26 12:00</span></div></div></main>')
      assert.ok((await page.evaluate(scanOwner)).some(f => f.kind === 'table-unused-space'))
      await page.locator('.table').evaluate(fitGridContentColumns)
      assert.deepEqual(await page.evaluate(scanOwner), [])
      const widths = await page.locator('.row').last().locator(':scope > span').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width))
      assert.ok(widths[1] > widths[2])
      const initial = await page.locator('.table').getAttribute('style')
      await page.locator('.table').evaluate(fitGridContentColumns)
      assert.equal(await page.locator('.table').getAttribute('style'), initial)
    }
  } finally { await browser.close() }
})

test('狭くても操作列は縮めず、幅を往復し短い内容に変えても同じ配分へ戻る', async () => {
  const { fitGridContentColumns } = await import('../../src/components/shared/grid-content-columns.mjs')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>*{box-sizing:border-box}.table{width:420px;font:14px Arial}.row{display:grid;grid-template-columns:var(--grid-table-content-columns,repeat(3,1fr));gap:12px}.text{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}button{width:112px}</style><main><div class="table" role="table"><div class="row" role="row"><span>名前</span><span>メール</span><span>操作</span></div><div class="row" role="row"><span class="text">とても長い担当者の名前</span><span class="text">long.member@example-company.test</span><span><button>権限を変更する</button></span></div></div></main>')
    await page.locator('.table').evaluate(fitGridContentColumns)
    const first = await page.locator('.table').getAttribute('style')
    for (const width of [720, 420]) {
      await page.locator('.table').evaluate((el, width) => { el.style.width = `${width}px` }, width)
      await page.locator('.table').evaluate(fitGridContentColumns)
      assert.equal(await page.locator('button').evaluate(el => el.getBoundingClientRect().width <= el.parentElement.getBoundingClientRect().width), true)
    }
    const after = await page.locator('.table').evaluate(el => el.style.getPropertyValue('--grid-table-content-columns'))
    assert.ok(first.includes(after))
    await page.locator('.text').last().evaluate(el => { el.textContent = 'a@b.test' })
    await page.locator('.table').evaluate(fitGridContentColumns)
    assert.notEqual(await page.locator('.table').evaluate(el => el.style.getPropertyValue('--grid-table-content-columns')), after)
  } finally { await browser.close() }
})

test('札の印・余白まで本来の幅で測り、状態の札を省略しない', async () => {
  const { fitGridContentColumns } = await import('../../src/components/shared/grid-content-columns.mjs')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>*{box-sizing:border-box}.table{width:760px;font:14px Arial}.row{display:grid;grid-template-columns:var(--grid-table-content-columns,repeat(3,minmax(0,1fr)));gap:16px}.pill{display:inline-flex;align-items:center;max-width:100%;padding:2px 10px;border-radius:99px;background:#eee}.pill::before{content:"";flex:none;width:8px;height:8px;margin-right:6px;border-radius:50%;background:green}.text{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><main><div class="table" role="table"><div class="row" role="row"><span>名前</span><span>メール</span><span>状態</span></div><div class="row" role="row"><span>担当者</span><span><span class="text">member@example.test</span></span><span><span class="pill"><span class="text">有効</span></span></span></div></div></main>')
    await page.locator('.table').evaluate(fitGridContentColumns)
    const pill = await page.locator('.pill .text').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    assert.ok(pill.scroll <= pill.client, JSON.stringify(pill))
  } finally { await browser.close() }
})
