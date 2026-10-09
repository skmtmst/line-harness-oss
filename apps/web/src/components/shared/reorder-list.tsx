'use client'

import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import IconButton from './icon-button'
import ReorderHandle, { useReorder } from './reorder-handle'
import styles from './reorder-list.module.css'

/** 並び替え窓の行。ドラッグ・上下キー・矢印を同じ下書きの並びへ反映する。 */
export default function ReorderList({ items, onChange, visibleRows }: {
  items: Array<{ id: string; label: string }>
  onChange: (ids: string[]) => void
  /** 長い区分は窓の中で送る。省略時は全行を表示。 */
  visibleRows?: number
}) {
  const reorder = useReorder({ items, idOf: (item) => item.id, onReorder: ({ ids }) => onChange(ids) })
  return (
    <ul className={styles.list} aria-label="並び替える項目" data-scroll={visibleRows ? '' : undefined}
      style={visibleRows ? { '--reorder-visible-rows': visibleRows } as CSSProperties : undefined}>
      {reorder.shown.map((item) => (
        <li key={item.id} className={styles.row} {...reorder.rowProps(item.id)}>
          <span className={styles.handle}><ReorderHandle label={item.label} {...reorder.handleProps(item.id)} {...reorder.handle(item.id)} /></span>
          <span className={styles.label} title={item.label}>{item.label}</span>
          <IconButton variant="plain" aria-label={`${item.label}を上へ`} disabled={!reorder.canMoveBy(item.id, -1)} onClick={() => reorder.moveBy(item.id, -1)}><ArrowUp size={16} aria-hidden="true" /></IconButton>
          <IconButton variant="plain" aria-label={`${item.label}を下へ`} disabled={!reorder.canMoveBy(item.id, 1)} onClick={() => reorder.moveBy(item.id, 1)}><ArrowDown size={16} aria-hidden="true" /></IconButton>
        </li>
      ))}
    </ul>
  )
}
