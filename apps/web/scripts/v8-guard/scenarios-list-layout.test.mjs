import test from 'node:test'
import { expect } from '@playwright/test'
import { connectGuardBrowser } from './browser-session.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openPage } from './browser-env.mjs'
import { scanLayoutOverflow } from './layout-overflow.mjs'
async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    const table = main?.querySelector('table')
    if (!main || !table) throw new Error('実一覧のmain/tableなし')
    const r = element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }
    }
    const rows = [...table.querySelectorAll('tbody tr[data-row-id]')]
    return {
      dataRowCount: rows.length, sixCellRowCount: rows.filter(row => row.children.length === 6).length,
      main: r(main), table: r(table), columns: [...table.querySelectorAll('col')].map(r),
      rows: rows.map(row => {
        const id = row.getAttribute('data-row-id'), cellCount = row.children.length
        if (cellCount !== 6) return { id, cellCount }
        const name = row.children[2].querySelector('[data-truncated-text]')
        const nameStyle = name ? getComputedStyle(name) : null
        return { id, cellCount, name: name ? { text: name.textContent, title: name.title, whiteSpace: nameStyle.whiteSpace, overflow: nameStyle.overflow, textOverflow: nameStyle.textOverflow, box: r(name) } : null,
        text: row.innerText, countText: row.children[3].innerText,
        count: r(row.children[3]), menu: r(row.children[5]),
        bars: [...row.querySelectorAll('[role="progressbar"]')].map(bar => ({ box: r(bar), value: bar.getAttribute('aria-valuenow'), max: bar.getAttribute('aria-valuemax'), label: bar.getAttribute('aria-label') })),
        actions: [...row.children[5].querySelectorAll('button')].map(button => ({ label: button.getAttribute('aria-label'), box: r(button) })),
      } }),
    }
  })
}
function numbersPreserved(row) {
  const match = row.countText.match(/配信中 ([\d,]+) 人・最後まで配信 ([\d,]+) 人/)
  if (!match) return false
  const active = Number(match[1].replaceAll(',', ''))
  const completed = Number(match[2].replaceAll(',', ''))
  const enrolled = active + completed
  if (enrolled === 0) return row.bars.length === 0 && row.countText.trim().endsWith('—')
  if (row.bars.length !== 1) return false
  return Number(row.bars[0].value) === completed && Number(row.bars[0].max) === enrolled && row.countText.includes(`登録した ${enrolled.toLocaleString('en-US')} 人の ${Math.round(completed / enrolled * 100)}%`)
}
function healthy(m) {
  return m.table.right <= m.main.right + 1 && m.columns.length === 6 && Math.abs(m.columns[3].width - 230) <= 1 && m.dataRowCount > 0 && m.rows.length === m.dataRowCount && m.sixCellRowCount === m.dataRowCount && m.rows.every(row => row.cellCount === 6 && row.name?.whiteSpace === 'nowrap' && row.name.overflow === 'hidden' && row.name.textOverflow === 'ellipsis' && row.name.title === row.name.text && row.name.box.width > 0 && numbersPreserved(row) && row.count.right <= m.main.right + 1 && row.menu.right <= m.main.right + 1 && row.bars.every(bar => bar.box.width >= 32) && row.actions.length > 0 && row.actions.every(action => action.box.width > 0 && action.box.height > 0 && action.box.right <= m.main.right + 1))
}
for (const width of [1152, 1440]) {
  test(`シナリオの実表で人数と操作を収め、固定名列の故障を検出する ${width}`, async () => {
    const browser = await connectGuardBrowser()
    const errors = []
    try {
      const fixtureBrowser = { newPage: async options => {
        const page = await browser.newPage(options)
        await stubApi(page, mockFetch)
        return page
      } }
      const page = await openPage(fixtureBrowser, { baseUrl: process.env.V8_GUARD_BASE ?? 'http://127.0.0.1:4310', route: '/scenarios', width, stable: true, requireSuccess: true, onPageError: error => errors.push(error.message) })
      expect(page.viewportSize()).toEqual({ width, height: 900 })
      const out = process.env.SCENARIO_LIST_SHOTS
      if (out) mkdirSync(out, { recursive: true })
      const shot = async phase => { if (out) await page.screenshot({ path: resolve(out, `scenarios-${width}-${phase}.png`) }) }
      await expect.poll(async () => healthy(await measure(page))).toBe(true)
      const normal = await measure(page)
      expect(errors).toEqual([])
      await shot('normal')
      const col = page.locator('main table colgroup col').nth(2)
      await col.evaluate(element => element.style.setProperty('width', '608px'))
      await expect.poll(async () => healthy(await measure(page))).toBe(false)
      const fault = await measure(page)
      expect(fault.table.right).toBeGreaterThan(fault.main.right + 1)
      await shot('fault')
      await col.evaluate(element => element.style.removeProperty('width'))
      await expect.poll(async () => healthy(await measure(page))).toBe(true)
      const restored = await measure(page)
      expect(restored).toEqual(normal)
      const dataRow = page.locator('main table tbody tr[data-row-id]').first()
      const lastCell = await dataRow.locator(':scope > td').last().elementHandle()
      expect(lastCell).not.toBeNull()
      await lastCell.evaluate(cell => cell.remove())
      const missingCell = await measure(page)
      expect(missingCell.dataRowCount).toBe(normal.dataRowCount)
      expect(missingCell.sixCellRowCount).toBe(normal.dataRowCount - 1)
      expect(healthy(missingCell)).toBe(false)
      await shot('missing-cell')
      await dataRow.evaluate((row, cell) => row.append(cell), lastCell)
      expect(await dataRow.evaluate((row, cell) => row.lastElementChild === cell, lastCell)).toBe(true)
      await expect.poll(async () => healthy(await measure(page))).toBe(true)
      const restoredCell = await measure(page)
      expect(restoredCell).toEqual(normal)
      await lastCell.dispose()
      const layout = await page.evaluate(scanLayoutOverflow)
      expect(layout.outOfMain).toEqual([])
      expect(layout.pageX).toBe(false)
      for (const key of ['overflow', 'noTitle', 'accountName', 'narrowColumn', 'cutAlert']) expect(layout[key]).toEqual([])
      expect(errors).toEqual([])
      await shot('restored')
      const result = { width, normal, fault, restored, missingCell, restoredCell, layout, errors }
      if (out) writeFileSync(resolve(out, `scenarios-${width}.json`), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result))
    } finally { await browser.close() }
  })
}
