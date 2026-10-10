'use client'

import { cloneElement, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import styles from './table-body.module.css'

/** Native table rows with a bounded rendering window. Small lists keep their exact markup. */
export function TableBody<T>({ items, itemKey, renderRow, colSpan, children, threshold = 60, estimatedRowHeight = 58 }: {
  items: readonly T[]
  itemKey: (item: T) => string
  renderRow: (item: T, index: number) => ReactElement
  colSpan: number
  children?: ReactNode
  threshold?: number
  estimatedRowHeight?: number
}) {
  const body = useRef<HTMLTableSectionElement>(null)
  const heights = useRef(new Map<string, number>())
  const estimate = useRef(estimatedRowHeight)
  const [window, setWindow] = useState({ start: 0, end: 20, retained: [] as number[] })
  const [revision, setRevision] = useState(0)
  const [visibleColumns, setVisibleColumns] = useState(colSpan)
  const virtual = items.length > threshold
  const keys = useMemo(() => items.map(itemKey), [items, itemKey])
  const offsets = useMemo(() => {
    // ResizeObserver advances the revision when the measured-height cache changes.
    void revision
    const values = [0]
    for (const key of keys) values.push(values[values.length - 1] + (heights.current.get(key) ?? estimate.current))
    return values
  }, [keys, revision])

  useLayoutEffect(() => {
    if (!virtual || !body.current) return
    const table = body.current.closest('table')
    if (!table) return
    const previous = table.getAttribute('aria-rowcount')
    table.setAttribute('aria-rowcount', String(items.length + (table.tHead?.rows.length ?? 0)))
    return () => {
      if (previous === null) table.removeAttribute('aria-rowcount')
      else table.setAttribute('aria-rowcount', previous)
    }
  }, [virtual, items.length])

  useLayoutEffect(() => {
    if (!virtual || !body.current) return
    const element = body.current
    let frame = 0
    const compute = () => {
      const firstRow = element.querySelector<HTMLTableRowElement>('[data-table-index]')
      if (firstRow) {
        const columns = [...firstRow.cells].reduce((sum, cell) => sum + (getComputedStyle(cell).display === 'none' ? 0 : cell.colSpan), 0)
        // A spacer spanning hidden columns creates anonymous columns and squeezes the name cell.
        if (columns > 0) setVisibleColumns((previous) => previous === columns ? previous : columns)
      }
      const rect = element.getBoundingClientRect()
      // Capture nested main/dialog scrollers too; their viewport can be shorter than the browser.
      let top = 0
      let bottom = globalThis.window.innerHeight
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
          const box = parent.getBoundingClientRect()
          top = Math.max(top, box.top)
          bottom = Math.min(bottom, box.bottom)
        }
      }
      const find = (position: number) => {
        let low = 0, high = items.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (offsets[middle + 1] <= position) low = middle + 1
          else high = middle
        }
        return low
      }
      const start = Math.max(0, find(Math.max(0, top - rect.top)) - 5)
      const end = Math.min(items.length, find(Math.max(0, bottom - rect.top)) + 6)
      const retained = new Set<number>()
      // Focus and open row menus/dialogs remain mounted, even after a jump to the far end.
      for (const row of element.querySelectorAll<HTMLElement>('[data-table-index]')) {
        if (row.contains(document.activeElement) || row.querySelector('[aria-expanded="true"], [aria-modal="true"]')) {
          const index = Number(row.dataset.tableIndex)
          for (let i = Math.max(0, index - 1); i <= Math.min(items.length - 1, index + 1); i++) retained.add(i)
        }
      }
      const pinned = [...retained].filter((i) => i < start || i >= end).sort((a, b) => a - b)
      setWindow((previous) => previous.start === start && previous.end === end && previous.retained.join() === pinned.join()
        ? previous : { start, end, retained: pinned })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; compute() })
    }
    compute()
    globalThis.window.addEventListener('scroll', schedule, { capture: true, passive: true })
    globalThis.window.addEventListener('resize', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    const observer = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const row = entry.target as HTMLTableRowElement
        const index = Number(row.dataset.tableIndex)
        const height = row.getBoundingClientRect().height
        const key = keys[index]
        if (key !== undefined && height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height)
          changed = true
        }
      }
      if (changed) {
        // Use the measured first row for unseen rows, while keeping measured variable heights.
        estimate.current = heights.current.get(keys[0]) ?? estimate.current
        setRevision((value) => value + 1)
      }
      schedule()
    })
    for (const row of element.querySelectorAll('[data-table-index]')) observer.observe(row)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      globalThis.window.removeEventListener('scroll', schedule, { capture: true })
      globalThis.window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
    }
  }, [virtual, items.length, keys, offsets, window.start, window.end, window.retained, colSpan])

  // Drop measurements for records that have gone away; page/account changes cannot grow this cache.
  useLayoutEffect(() => {
    const alive = new Set(keys)
    for (const key of heights.current.keys()) if (!alive.has(key)) heights.current.delete(key)
  }, [keys])

  const focusAdjacent = useCallback((event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (!virtual || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('[data-table-index]')
    if (!row) return
    const controls = [...row.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      .filter((el) => el.getClientRects().length > 0)
    if (event.target !== (event.shiftKey ? controls[0] : controls[controls.length - 1])) return
    const index = Number(row.dataset.tableIndex) + (event.shiftKey ? -1 : 1)
    if (index < 0 || index >= items.length || body.current?.querySelector(`[data-table-index="${index}"]`)) return
    event.preventDefault()
    setWindow((previous) => ({ ...previous, retained: [...new Set([...previous.retained, index])] }))
    requestAnimationFrame(() => {
      const target = body.current?.querySelector(`[data-table-index="${index}"]`)
      const next = [...(target?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])]
        .filter((el) => el.getClientRects().length > 0)
      ;(event.shiftKey ? next[next.length - 1] : next[0])?.focus()
    })
  }, [virtual, items.length])

  if (!virtual) return <tbody>{children}{items.map((item, index) => cloneElement(renderRow(item, index), { key: itemKey(item) }))}</tbody>
  const indices = [...new Set([
    ...Array.from({ length: Math.max(0, Math.min(items.length, window.end) - window.start) }, (_, i) => window.start + i),
    ...window.retained.filter((i) => i < items.length),
  ])].sort((a, b) => a - b)
  const rows: ReactNode[] = []
  let previous = 0
  const spacer = (from: number, to: number) => {
    if (to <= from) return
    rows.push(<tr key={`spacer-${from}`} aria-hidden="true" className={styles.spacer}>
      <td colSpan={visibleColumns} style={{ height: offsets[to] - offsets[from] }} />
    </tr>)
  }
  for (const index of indices) {
    spacer(previous, index)
    rows.push(cloneElement(renderRow(items[index], index) as ReactElement<Record<string, unknown>>, {
      key: keys[index], 'data-table-index': index, 'aria-rowindex': index + 2,
    }))
    previous = index + 1
  }
  spacer(previous, items.length)
  return <tbody ref={body} data-virtual-table="" data-row-count={items.length} onKeyDownCapture={focusAdjacent}>{rows}</tbody>
}
