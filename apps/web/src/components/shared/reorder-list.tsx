'use client'

import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import IconButton from './icon-button'
import ReorderHandle, { useReorder } from './reorder-handle'
import styles from './reorder-list.module.css'
import { Field } from './form-controls'
import Select from './select'

/** 並び替え窓の行。ドラッグ・上下キー・矢印を同じ下書きの並びへ反映する。 */
export default function ReorderList({ items, onChange, visibleRows, group }: {
  items: Array<{ id: string; label: string }>
  onChange: (ids: string[]) => void
  /** 長い区分は窓の中で送る。省略時は全行を表示。 */
  visibleRows?: number
  /** 区分ごとの下書きを保ち、並べ替える対象だけを切り替える。 */
  group?: { label: string; ariaLabel: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }
}) {
  const reorder = useReorder({ items, idOf: (item) => item.id, onReorder: ({ ids }) => onChange(ids) })
  return (
    <>
    {group ? <Field label={group.label}><Select aria-label={group.ariaLabel} value={group.value} options={group.options} onChange={group.onChange} /></Field> : null}
    <ul className={styles.list} aria-label="並び替える項目" data-scroll={visibleRows ? '' : undefined}
      style={visibleRows ? { '--reorder-visible-rows': visibleRows } as CSSProperties : undefined}>
      {reorder.shown.map((item) => (
        <li key={item.id} className={styles.row} {...reorder.rowProps(item.id)}>
          <span className={styles.handle}><ReorderHandle label={item.label} {...reorder.handleProps(item.id)} {...reorder.handle(item.id)} /></span>
          <span className={styles.label} title={item.label}>{item.label}</span>
          <IconButton variant="plain" aria-label={`${item.label}を上へ`} title={!reorder.canMoveBy(item.id, -1) ? '先頭の項目は上へ動かせません。' : undefined} disabled={!reorder.canMoveBy(item.id, -1)} onClick={() => reorder.moveBy(item.id, -1)}><ArrowUp size={16} aria-hidden="true" /></IconButton>
          <IconButton variant="plain" aria-label={`${item.label}を下へ`} title={!reorder.canMoveBy(item.id, 1) ? '最後の項目は下へ動かせません。' : undefined} disabled={!reorder.canMoveBy(item.id, 1)} onClick={() => reorder.moveBy(item.id, 1)}><ArrowDown size={16} aria-hidden="true" /></IconButton>
        </li>
      ))}
    </ul>
    </>
  )
}
