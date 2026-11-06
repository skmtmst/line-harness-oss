'use client'

import type { ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import Avatar from './avatar'
import Button from './button'
import styles from './friend-match-row.module.css'

/** 検索した友だちの選択。選択の帯は外側だけが持つ。 */
export default function FriendMatchRow({ name, description, selected, onSelect, onClear, inset = false, avatar = true }: {
  name: string
  description?: ReactNode
  selected: boolean
  onSelect?: () => void
  onClear?: () => void
  inset?: boolean
  avatar?: boolean
}) {
  const content = <>
    {avatar ? <Avatar name={name} size={28} /> : null}
    <span className={styles.details} data-inline={!avatar || undefined}>
      <span className={styles.name} title={name}>{name}</span>
      {description ? <span className={styles.description}>{description}</span> : null}
    </span>
    {onClear ? <Button variant="text" size="inline" onClick={onClear}>選び直す</Button>
      : <span className={styles.action}>{selected ? <><CircleCheck aria-hidden="true" />選択中</> : '選ぶ'}</span>}
  </>
  return <div className={styles.root} data-shared-part="friend-match-row" data-selected={selected || undefined} data-inset={inset || undefined}>
    {onSelect ? <button type="button" className={styles.row} aria-pressed={selected} onClick={onSelect}>{content}</button>
      : <div className={styles.row}>{content}</div>}
  </div>
}
