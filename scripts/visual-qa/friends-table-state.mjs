/** Browser predicate: the 2,000-record fixture has a measured, bounded row window.
 * Chromium can retain a 1/16px native-table rounding remainder after all rows are measured.
 * Allow at most 1/8 CSS px across the entire table, never a per-row allowance.
 * This function is serialized by Playwright, so it must not capture module bindings.
 */
export function friendsTableReady({ expectedRows = 2000, targetIndex = null, focusedIndex = null, snapshot = false } = {}) {
  const body = document.querySelector('tbody[data-virtual-table]')
  if (!body || Number(body.dataset.rowCount) !== expectedRows) return false
  const rows = [...body.querySelectorAll('[data-friend-row]')]
  if (!rows.length || rows.length >= 60) return false
  const indices = rows.map(row => Number(row.dataset.tableIndex))
  if (new Set(indices).size !== rows.length
    || indices.some(index => !Number.isInteger(index) || index < 0 || index >= expectedRows)) return false
  const height = rows[0].getBoundingClientRect().height
  if (!(height > 0) || !rows.every(row => row.getBoundingClientRect().height === height)) return false
  if (Math.abs(body.getBoundingClientRect().height - expectedRows * height) > 1 / 8) return false
  if (targetIndex !== null && !indices.includes(targetIndex)) return false
  if (focusedIndex !== null
    && Number(document.activeElement?.closest('[data-table-index]')?.dataset.tableIndex) !== focusedIndex) return false
  if (snapshot) {
    const main = document.querySelector('main')
    const table = body.closest('table')
    if (!main || !table) return false
    const mainBox = main.getBoundingClientRect()
    // Capture the geometry in the same browser task as the readiness checks.
    // A later evaluate can see a different ResizeObserver/render cycle.
    return {
      rows: Number(body.dataset.rowCount),
      height: body.getBoundingClientRect().height, rendered: rows.length,
      tableRight: body.getBoundingClientRect().right, mainRight: mainBox.right,
      missingNames: rows.filter(row => row.querySelector('a[title]')?.getBoundingClientRect().width < 30).length,
      rowHeights: [...new Set(rows.map(row => row.getBoundingClientRect().height))],
      pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      tableX: table.scrollWidth > table.clientWidth,
      outside: rows.filter(row => row.getBoundingClientRect().right > mainBox.right + 1).length,
    }
  }
  return true
}

export async function snapshotFriendsTable(page, options = {}) {
  const handle = await page.waitForFunction(friendsTableReady, { ...options, snapshot: true })
  try { return await handle.jsonValue() }
  finally { await handle.dispose() }
}
