'use client'

import type { CSSProperties, ReactNode } from 'react'
import { TagColorDot } from './tag-pill'
import { bookingStateLabels, type BookingState } from './booking-state'
import styles from './booking-state.module.css'

export function BookingStatus({ state, children }: { state: BookingState; children?: ReactNode }) {
  return <span className={`${styles.surface} ${styles.label}`} data-booking-state={state}>{children ?? bookingStateLabels[state]}</span>
}

export function BookingLegendItem({ state, children }: { state: BookingState; children?: ReactNode }) {
  return <span className={styles.legendItem}><span aria-hidden="true" className={`${styles.surface} ${styles.sample}`} data-booking-state={state} />{children ?? bookingStateLabels[state]}</span>
}

export function BookingLegend() {
  return <div className={styles.legend} role="list" aria-label="予約の状態">{(Object.keys(bookingStateLabels) as BookingState[]).map(state => <span key={state} role="listitem"><BookingLegendItem state={state} /></span>)}</div>
}

/** 種類名を文字で伝え、分類色を装飾の丸だけに使う。 */
export function BookingCategory({ name, color }: { name: string; color?: string }) {
  return <span className={styles.category} title={name}><TagColorDot color={color} /><span className={styles.categoryText}>{name}</span></span>
}

const sourceNames: Record<string, string> = { line: 'LINE', liff: 'LINE', restaurant_board: 'レストランボード', tabelog: '食べログ', hotpepper: 'ホットペッパー', ikyu: '一休', phone: '電話', manual: '電話', walk_in: 'ウォークイン', counter: '店頭', operator: '手入力', import: '取り込み' }
const sourceColors: Record<string, string> = { phone: 'var(--color-status-info)', manual: 'var(--color-status-info)', line: 'var(--color-accent-deep)', liff: 'var(--color-accent-deep)', restaurant_board: 'var(--color-accent-deep)', tabelog: 'var(--color-danger)', hotpepper: 'var(--color-danger)', ikyu: 'var(--color-danger)' }
export function ReservationSource({ value, note, label }: { value: string; note?: string | null; label?: string }) {
  const name = label ?? (value === 'manual' && note?.startsWith('ウォークイン') ? 'ウォークイン' : sourceNames[value] ?? value)
  return <span data-source={value}><BookingCategory name={name} color={sourceColors[value]} /></span>
}

export function BookingSourceLegend({ sources }: { sources: string[] }) {
  return <span className={styles.legend} role="list" aria-label="予約元">{sources.map(value => <span key={value} role="listitem"><ReservationSource value={value}/></span>)}</span>
}

export function BookingName({ children }: { children: ReactNode }) { return <strong className={styles.name}>{children}</strong> }
export function BookingTime({ children }: { children: ReactNode }) { return <span className={styles.time}>{children}</span> }
export function BookingDetail({ children }: { children: ReactNode }) { return <span className={styles.detail}>{children}</span> }

export function BookingSummary({ time, children }: { time: string; children: ReactNode }) {
  return <span className={styles.summary}><BookingTime>{time}</BookingTime><BookingDetail>{children}</BookingDetail></span>
}

export function BookingGap({ minutes, style }: { minutes: number; style?: CSSProperties }) {
  return <span className={styles.gap} style={style} aria-label={`次の予約まで空き${minutes}分`}>{minutes}分</span>
}

export function BookingNowLine({ time, direction = 'vertical', labelPosition = 'inline', style }: { time: string; direction?: 'vertical' | 'horizontal'; labelPosition?: 'inline' | 'above'; style?: CSSProperties }) {
  return <div className={styles.now} data-booking-now data-direction={direction} data-label-position={labelPosition} style={style} aria-label={`今 ${time}`}><span>{time}</span></div>
}
