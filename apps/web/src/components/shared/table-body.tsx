'use client'

import { cloneElement, memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { cancelMeasurement, scheduleMeasurement } from './dom-measurement-batch'
import styles from './table-body.module.css'

// Window/height updates do not change an existing row's data or event handlers.
// Keep its children mounted without recreating their measurement effects.
const WindowedRow = memo(function WindowedRow<T>({ item, index, renderRow }: {
  item: T
  index: number
  renderRow: (item: T, index: number) => ReactElement
}) {
  return cloneElement(renderRow(item, index) as ReactElement<Record<string, unknown>>, {
    'data-table-index': index, 'aria-rowindex': index + 2,
  })
}) as <T>(props: { item: T; index: number; renderRow: (item: T, index: number) => ReactElement }) => ReactElement

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
  const rowObserver = useRef<ResizeObserver | null>(null)
  const observedRows = useRef(new Set<Element>())
  const estimate = useRef(estimatedRowHeight)
  const [window, setWindow] = useState({ start: 0, end: 20, retained: [] as number[] })
  const [revision, setRevision] = useState(0)
  const [visibleColumns, setVisibleColumns] = useState(colSpan)
  const virtual = items.length > threshold
  const keys = useMemo(() => items.map(itemKey), [items, itemKey])
  const offsets = useMemo(() => {
    // ResizeObserver advances the revision only when effective row offsets change.
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

  const model = useRef({ keys, offsets, length: items.length, colSpan })
  const queueCompute = useRef<(structure?: boolean) => void>(() => {})

  useLayoutEffect(() => {
    if (!virtual || !body.current) return
    const element = body.current
    let frame = 0
    let active = true
    let structureDirty = true
    let scrollParents: HTMLElement[] = []
    const measurementKey = {}
    const widths = new WeakMap<Element, number>()
    const compute = () => {
      if (!active) return () => {}
      const { offsets, length } = model.current
      let columns: number | undefined
      if (structureDirty) {
        structureDirty = false
        const firstRow = element.querySelector<HTMLTableRowElement>('[data-table-index]')
        if (firstRow) {
          columns = [...firstRow.cells].reduce((sum, cell) => sum + (getComputedStyle(cell).display === 'none' ? 0 : cell.colSpan), 0)
        }
        scrollParents = []
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) scrollParents.push(parent)
        }
      }
      const rect = element.getBoundingClientRect()
      // Capture nested main/dialog scrollers too; their viewport can be shorter than the browser.
      let top = 0
      let bottom = globalThis.window.innerHeight
      for (const parent of scrollParents) {
        const box = parent.getBoundingClientRect()
        top = Math.max(top, box.top)
        bottom = Math.min(bottom, box.bottom)
      }
      const find = (position: number) => {
        let low = 0, high = length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (offsets[middle + 1] <= position) low = middle + 1
          else high = middle
        }
        return low
      }
      const start = Math.max(0, find(Math.max(0, top - rect.top)) - 5)
      const end = Math.min(length, find(Math.max(0, bottom - rect.top)) + 6)
      const retained = new Set<number>()
      // Focus and open row menus/dialogs remain mounted, even after a jump to the far end.
      for (const row of element.querySelectorAll<HTMLElement>('[data-table-index]')) {
        if (row.contains(document.activeElement) || row.querySelector('[aria-expanded="true"], [aria-modal="true"]')) {
          const index = Number(row.dataset.tableIndex)
          for (let i = Math.max(0, index - 1); i <= Math.min(length - 1, index + 1); i++) retained.add(i)
        }
      }
      const pinned = [...retained].filter((i) => i < start || i >= end).sort((a, b) => a - b)
      return () => {
        if (!active) return
        if (columns !== undefined && columns > 0) setVisibleColumns(previous => previous === columns ? previous : columns)
        setWindow((previous) => previous.start === start && previous.end === end && previous.retained.join() === pinned.join()
        ? previous : { start, end, retained: pinned })
      }
    }
    const queue = (structure = false) => {
      if (!active) return
      structureDirty ||= structure
      scheduleMeasurement(measurementKey, compute)
    }
    queueCompute.current = queue
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; queue() })
    }
    const resize = () => { structureDirty = true; schedule() }
    queue(true)
    globalThis.window.addEventListener('scroll', schedule, { capture: true, passive: true })
    globalThis.window.addEventListener('resize', resize)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    const observer = new ResizeObserver((entries) => {
      let changed = false
      let geometryChanged = false
      for (const entry of entries) {
        const row = entry.target as HTMLTableRowElement
        const index = Number(row.dataset.tableIndex)
        // Native RO already measured these border-box dimensions.
        const box = entry.borderBoxSize?.[0]
        const fallback = box ? null : row.getBoundingClientRect()
        const height = box?.blockSize ?? fallback!.height
        const width = box?.inlineSize ?? fallback!.width
        const previousWidth = widths.get(row)
        widths.set(row, width)
        if (previousWidth !== undefined && previousWidth !== width) structureDirty = true
        const key = model.current.keys[index]
        if (key !== undefined && height > 0 && heights.current.get(key) !== height) {
          geometryChanged ||= (heights.current.get(key) ?? estimate.current) !== height
          heights.current.set(key, height)
          changed = true
        }
      }
      if (changed) {
        // Use the measured first row for unseen rows, while keeping measured variable heights.
        const nextEstimate = heights.current.get(model.current.keys[0]) ?? estimate.current
        geometryChanged ||= nextEstimate !== estimate.current
        estimate.current = nextEstimate
        if (geometryChanged) setRevision((value) => value + 1)
      }
      schedule()
    })
    rowObserver.current = observer
    return () => {
      active = false
      queueCompute.current = () => {}
      cancelMeasurement(measurementKey)
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      rowObserver.current = null
      observedRows.current.clear()
      globalThis.window.removeEventListener('scroll', schedule, { capture: true })
      globalThis.window.removeEventListener('resize', resize)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
    }
  }, [virtual])

  useLayoutEffect(() => {
    const structure = model.current.keys !== keys || model.current.colSpan !== colSpan
    model.current = { keys, offsets, length: items.length, colSpan }
    queueCompute.current(structure)
  }, [keys, offsets, items.length, colSpan])

  // A scroll only changes which rows are mounted. Keep listeners and the observer
  // alive, and subscribe just the entering rows before the browser measures them.
  useLayoutEffect(() => {
    const observer = rowObserver.current
    if (!observer || !body.current) return
    const mounted = new Set(body.current.querySelectorAll('[data-table-index]'))
    for (const row of observedRows.current) if (!mounted.has(row)) observer.unobserve(row)
    for (const row of mounted) if (!observedRows.current.has(row)) observer.observe(row)
    observedRows.current = mounted
  })

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
    rows.push(<WindowedRow key={keys[index]} item={items[index]} index={index} renderRow={renderRow} />)
    previous = index + 1
  }
  spacer(previous, items.length)
  return <tbody ref={body} data-virtual-table="" data-row-count={items.length} onKeyDownCapture={focusAdjacent}>{rows}</tbody>
}
