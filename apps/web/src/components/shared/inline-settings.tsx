'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import Card from './card'
import Button from './button'
import styles from './inline-settings.module.css'

/** B-177: 項目の設定はその項目の中で開く。窓や別のフォーカス面を増やさない。 */
export default function InlineSettings({ open, title, children, onClose, footer }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus({ preventScroll: true })
  }, [open])
  if (!open) return null
  return <Card padding="roomy" layout="vertical" className={styles.card}>
    <div className={styles.body} ref={ref} tabIndex={-1} role="region" aria-labelledby={id} data-inline-settings>
      <h3 className={styles.title} id={id}>{title}</h3>
      {children}
      {footer ?? <Button onClick={onClose}>設定を閉じる</Button>}
    </div>
  </Card>
}
