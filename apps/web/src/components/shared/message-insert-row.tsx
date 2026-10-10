'use client'

import { forwardRef, useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { User, IdCard, Braces, Calendar, Ellipsis } from 'lucide-react'
import styles from './message-insert-row.module.css'
import MenuPortal from './menu-portal'

export type MessageInsertKind = 'name' | 'field' | 'var' | 'date' | 'other'
const ICONS = { name: User, field: IdCard, var: Braces, date: Calendar, other: Ellipsis }
/** 店・統括の種類と処理だけを渡す。見た目は本文の枠内で共通。 */
export const MessageInsertButton = forwardRef<HTMLButtonElement, {
  kind: MessageInsertKind; label: ReactNode; onClick: () => void; disabled?: boolean
  title?: string; expanded?: boolean
}>(function MessageInsertButton({ kind, label, onClick, disabled, title, expanded }, ref: Ref<HTMLButtonElement>) {
  const Icon = ICONS[kind]
  return <button ref={ref} type="button" data-message-insert-button={kind} className={styles.button} onClick={onClick} disabled={disabled} title={title} aria-expanded={expanded} aria-haspopup={expanded === undefined ? undefined : 'menu'}><Icon aria-hidden="true" />{label}</button>
})
export default function MessageInsertRow({ children, count, more }: { children: ReactNode; count?: ReactNode; more?: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const body = rowRef.current?.closest('[data-message-body]')
    if (!body || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 560))
    observer.observe(body)
    return () => observer.disconnect()
  }, [])
  return <div ref={rowRef} data-message-insert-row className={styles.row} role="group" aria-label="利用できる差し込み項目">
    <div className={styles.controls}><span className={styles.label}>差し込む</span>{children}
      {more ? narrow ? <MessageInsertButton ref={moreRef} kind="other" label="その他" expanded={open} onClick={() => setOpen(value => !value)} /> : <div className={styles.controls}>{more}</div> : null}
    </div>
    {count === undefined ? null : <span data-message-character-count className={styles.count}>{count}</span>}
    {more && narrow ? <MenuPortal open={open} getAnchor={() => moreRef.current} onClose={() => setOpen(false)}><div className={styles.more} role="group" aria-label="その他の差し込み">{more}</div></MenuPortal> : null}
  </div>
}
/** 本文の入力欄と差し込み行を1つの枠に置く。 */
export function MessageBody({ children }: { children: ReactNode }) {
  return <div data-message-body className={styles.body}>{children}</div>
}
