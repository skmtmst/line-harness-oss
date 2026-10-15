'use client'

import { CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import Card from './card'
import StatusBadge from './status-badge'
import styles from './verification-list.module.css'

export type VerificationItem = {
  key: string
  title: string
  detail: string
  state: 'passed' | 'failed' | 'todo'
}

/** 接続の確認は文字の自然高で並べ、失敗の説明は全文を残す。 */
export default function VerificationList({ items, label = '接続確認項目' }: { items: VerificationItem[]; label?: string }) {
  if (!items.length) return null
  return <Card padding="none"><ol className={styles.list} aria-label={label} data-shared-part="verification-list">
    {items.map(item => {
      const Icon = item.state === 'passed' ? CircleCheck : item.state === 'failed' ? CircleX : CircleDashed
      return <li key={item.key} className={styles.row} data-state={item.state} data-verification-state={item.state}>
        <Icon size={16} className={styles.icon} aria-hidden="true" />
        <strong className={styles.title}>{item.title}</strong>
        <span className={styles.detail} title={item.detail}>{item.detail}</span>
        <StatusBadge tone={item.state === 'passed' ? 'success' : item.state === 'failed' ? 'neutral' : 'warning'}>
          {item.state === 'passed' ? '通った' : item.state === 'failed' ? '止まった' : 'まだ'}
        </StatusBadge>
      </li>
    })}
  </ol></Card>
}
