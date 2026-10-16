'use client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './calendar-parts.module.css'

/** 時間盤の空き枠。媒体の取込欄とは別の予約操作。 */
export function CalendarSlotButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" className={styles.freeSlot} />
}
export function CalendarLegendItem({ state, children }: { state: string; children: ReactNode }) {
  return <span className={styles.legendItem} data-state={state}>{children}</span>
}
export function CalendarPerson({ href, name, secondary }: { href: string; name: string; secondary: ReactNode }) {
  return <span className={styles.dayName}><a href={href}>{name}</a>{secondary}</span>
}
