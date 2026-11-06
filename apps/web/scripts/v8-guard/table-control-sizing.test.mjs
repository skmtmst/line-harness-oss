import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import { fitListColumns } from '../../src/components/shared/list-column-sizing.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = name => read(`../../src/components/shared/${name}.module.css`).replace(/:global\(([^)]+)\)/g, '$1')

test('control columns fit complete badges and actions without changing ordinary column budgets', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) for (const flex of [false, true]) {
      await page.setViewportSize({ width, height: 900 })
      const badge = '<span class="badge" data-design-node="xRvDB"><span class="label">返していない</span></span>'
      const row = pending => `<tr ${flex ? 'data-table-layout="columns"' : ''}><td data-cell-grow>名前</td><td>補足</td><td>${pending ? `<span class="actions">${badge}<span class="grow"></span><button>却下</button><button>✓ 承認</button><button data-row-menu>…</button></span>` : badge}</td></tr>`
      await page.setContent(`<html data-theme="v8"><style>${read('../../src/app/globals.css')}${css('data-table')}
        *{box-sizing:border-box}.frame{width:calc(100vw - 340px)}table{width:100%;table-layout:fixed}th,td{padding:0 8px;font:12px sans-serif}th:nth-child(2),td:nth-child(2){width:180px}th:last-child,td:last-child{width:80px}.badge{display:inline-flex;gap:8px;padding:2px 8px;max-width:100%;flex-shrink:0}.badge::before{content:'';width:6px;height:6px;flex:none}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.actions{display:flex;gap:8px;align-items:center}.grow{flex:1}button{flex:none;white-space:nowrap}
        ${flex ? 'table,thead,tbody{display:block}tr{display:flex}th,td{flex:none}th:first-child,td:first-child{flex:1 1 0;min-width:0}' : ''}</style>
        <div class="frame" data-column-sizing="controls"><table class="table"><thead><tr ${flex ? 'data-table-layout="columns"' : ''}><th>名前</th><th>補足</th><th>状態・操作</th></tr></thead><tbody>${row(true)}${row(false)}</tbody></table></div></html>`)
      const check = () => page.locator('.frame').evaluate(frame => {
        const rows = [...frame.querySelectorAll('tr')]
        const widths = rows.map(row => [...row.children].map(cell => cell.getBoundingClientRect().width))
        const clipped = [...frame.querySelectorAll('.label')].filter(el => el.scrollWidth > el.clientWidth).length
        const spill = [...frame.querySelectorAll('tbody td:last-child button')].filter(el => {
          const rect = el.getBoundingClientRect(), cell = el.closest('td'), c = cell.getBoundingClientRect()
          return rect.right > c.right - parseFloat(getComputedStyle(cell).paddingRight) + 1
        }).length
        const labels = [...frame.querySelectorAll('.label')].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, text: el.textContent }))
        return { widths, clipped, spill, labels, overflow: document.documentElement.scrollWidth - innerWidth }
      })
      assert.ok((await check()).clipped > 0 || (await check()).spill > 0, 'old fixed column must expose the cut')
      await page.locator('.frame').evaluate(fitListColumns)
      const good = await check()
      assert.equal(good.clipped, 0, JSON.stringify({ width, flex, good }))
      assert.equal(good.spill, 0, JSON.stringify({ width, flex, good }))
      assert.equal(good.overflow, 0)
      assert.equal(good.widths[0][1], 180, 'ordinary text keeps its previous truncation budget')
      assert.deepEqual(good.widths[0], good.widths[1], 'head and body use the same column allocation')
      for (let i = 0; i < 5; i++) await page.locator('.frame').evaluate(fitListColumns)
      assert.deepEqual(await check(), good, 'empty flexible spacers cannot grow the column on each measurement')
      await page.locator('.frame').evaluate(frame => {
        frame.removeAttribute('data-column-sizing')
        for (const cell of frame.querySelectorAll('th,td')) {
          cell.removeAttribute('data-content-name-column'); cell.removeAttribute('data-content-support-column')
        }
      })
      assert.ok((await check()).clipped > 0 || (await check()).spill > 0, 'removing the shared allocation must fail again')
    }
  } finally { await browser.close() }
})
