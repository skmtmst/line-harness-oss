'use client'

import { Fragment } from 'react'
import { formatNumber } from '@/lib/format'
import styles from './heatmap-table.module.css'

export type HeatmapCell = { key: string; name: string; count: number | null }
/** 行・列・人数だけを受ける濃淡の表。未取得のマスは選べず、0は人数として表示する。 */
export default function HeatmapTable({ label, columns, rows, selected, onSelect }: {
  label: string
  columns: string[]
  rows: { key: string; label: string; cells: HeatmapCell[] }[]
  selected?: string
  onSelect: (row: string, column: string) => void
}) {
  const max = Math.max(0, ...rows.flatMap(row => row.cells.map(cell => cell.count ?? 0)))
  const level = (count: number | null) => !count || !max ? 0 : count / max > .75 ? 4 : count / max > .5 ? 3 : count / max > .25 ? 2 : 1
  return <div className={styles.grid} role="grid" aria-label={label}>
    <span className={styles.gridFixed} aria-hidden="true" />
    {columns.map(column => <span key={column} className={styles.colHead} role="columnheader">{column}</span>)}
    {rows.map(row => <Fragment key={row.key}>
      <span className={styles.rowHead} role="rowheader">{row.label}</span>
      {row.cells.map(cell => <button key={cell.key} type="button" className={styles.cell} data-level={level(cell.count)}
        aria-pressed={selected === `${row.key}:${cell.key}`} aria-label={`${cell.name} ${cell.count === null ? '人数は未取得' : `${formatNumber(cell.count)} 人`}`}
        disabled={cell.count === null} onClick={() => onSelect(row.key, cell.key)}>
        <span className={styles.cellName} title={cell.name}>{cell.name}</span>
        <span className={styles.cellCount}>{cell.count === null ? '—' : `${formatNumber(cell.count)} 人`}</span>
      </button>)}
    </Fragment>)}
  </div>
}
