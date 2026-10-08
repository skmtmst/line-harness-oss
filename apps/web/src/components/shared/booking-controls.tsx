'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './booking-controls.module.css'

type ControlProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { children: ReactNode }

/** 行をまたぐ予約を開く操作。内容・予約元は呼び出し側が渡す。 */
export function BookingBlock({ tone, children, ...props }: ControlProps & { tone: 'line' | 'media' | 'phone' | 'pending' | 'hold' }) {
  const tones = { line: styles.blockLine, media: styles.blockMedia, phone: styles.blockPhone, pending: styles.blockPending, hold: styles.blockHold }
  return <button type="button" {...props} className={`${styles.block} ${tones[tone]}`}>{children}</button>
}

/** 空いている枠に予約を追加する。セルに指を乗せるかキーボードで選ぶと表示する。 */
export function BookingSlot({ children, ...props }: ControlProps) {
  return <button type="button" {...props} className={styles.slotAdd} data-booking-add>{children}</button>
}

/** 卓を選ぶ操作。埋まっている卓は選べず、選択状態も読み上げる。 */
export function TableChoice({ selected, unavailable, children, ...props }: ControlProps & { selected: boolean; unavailable: boolean }) {
  return <button type="button" {...props} aria-pressed={selected} disabled={unavailable || props.disabled} className={`${styles.phoneTable} ${unavailable ? styles.phoneTableTaken : selected ? styles.phoneTableChosen : ''}`}>{children}</button>
}
