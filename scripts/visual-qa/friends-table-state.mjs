/** Browser predicate: the 2,000-record fixture has a measured, bounded row window.
 * Chromium can retain a 1/16px native-table rounding remainder after all rows are measured.
 * Allow at most 1/8 CSS px across the entire table, never a per-row allowance.
 * This function is serialized by Playwright, so it must not capture module bindings.
 */
export function friendsTableReady({ expectedRows = 2000, targetIndex = null, focusedIndex = null } = {}) {
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
  return true
}
