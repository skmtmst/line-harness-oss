'use client'

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { TagColorDot } from './tag-pill'
import { bookingStateLabels, type BookingState } from './booking-state'
import styles from './booking-state.module.css'
import HelpTip from './help-tip'
import StatusBadge from './status-badge'
import Avatar from './avatar'
import { CircleHelp } from 'lucide-react'

export function BookingStatus({ state, children, title }: { state: BookingState; children?: ReactNode; title?: string }) {
  return <span className={`${styles.surface} ${styles.label}`} data-booking-state={state} title={title ?? (typeof children === 'string' ? children : bookingStateLabels[state])}><span className={styles.statusText}>{children ?? bookingStateLabels[state]}</span></span>
}

export function BookingLegendItem({ state, children }: { state: BookingState; children?: ReactNode }) {
  return <span className={styles.legendItem}><span aria-hidden="true" className={`${styles.surface} ${styles.sample}`} data-booking-state={state} />{children ?? bookingStateLabels[state]}</span>
}

const allBookingStates = Object.keys(bookingStateLabels) as BookingState[]

/** 状態の見本。`states` を渡すと、その状態だけを決まった並びで出す。 */
export function BookingLegend({ dense = false, states, label = '予約の状態' }: { dense?: boolean; states?: readonly BookingState[]; label?: string }) {
  const shown = states ? allBookingStates.filter(state => states.includes(state)) : allBookingStates
  return <div className={dense ? `${styles.legend} ${styles.legendDense}` : styles.legend} role="list" aria-label={label}>{shown.map(state => <span key={state} role="listitem"><BookingLegendItem state={state} /></span>)}</div>
}

/** 表に現れる状態の見本と、全状態を開く共通の入口。 */
export function BookingVisibleLegend({ states, inline = false }: { states: readonly BookingState[]; inline?: boolean }) {
  return <div className={inline ? styles.visibleLegendInline : styles.visibleLegend}><BookingLegend dense states={states} /><span className={styles.legendHelp}><HelpTip label="予約の印の見本" trigger={<span className={styles.legendItem}><CircleHelp size={14} aria-hidden="true" />印の見本</span>}><BookingLegend dense label="予約の印の見本" /></HelpTip></span></div>
}

/** 種類名を文字で伝え、分類色を装飾の丸だけに使う。 */
export function BookingCategory({ name, color }: { name: string; color?: string }) {
  return <span className={styles.category} title={name}><TagColorDot color={color} /><span className={styles.categoryText}>{name}</span></span>
}

const sourceNames: Record<string, string> = { line: 'LINE', liff: 'LINE', restaurant_board: 'レストランボード', tabelog: '食べログ', hotpepper: 'ホットペッパー', ikyu: '一休', phone: '電話', manual: '手入力', walk_in: 'ウォークイン', counter: '店頭', operator: '手入力', import: '取り込み' }
const sourceColors: Record<string, string> = { phone: 'var(--color-status-info)', line: 'var(--color-accent-deep)', liff: 'var(--color-accent-deep)', restaurant_board: 'var(--color-accent-deep)', tabelog: 'var(--color-danger)', hotpepper: 'var(--color-danger)', ikyu: 'var(--color-danger)' }
export function ReservationSource({ value, note, label }: { value: string; note?: string | null; label?: string }) {
  const name = label ?? (value === 'manual' && note?.startsWith('ウォークイン') ? 'ウォークイン' : sourceNames[value] ?? value)
  return <span data-source={value}><BookingCategory name={name} color={sourceColors[value]} /></span>
}

export function BookingSourceLegend({ sources }: { sources: string[] }) {
  return <span className={styles.legend} role="list" aria-label="予約元">{sources.map(value => <span key={value} role="listitem"><ReservationSource value={value}/></span>)}</span>
}

export function BookingName({ children, title, ...props }: HTMLAttributes<HTMLElement>) { return <strong {...props} className={styles.name} title={title ?? (typeof children === 'string' ? children : undefined)}>{children}</strong> }
export function BookingTime({ children, title, ...props }: HTMLAttributes<HTMLElement>) { return <span {...props} className={styles.time} title={title ?? (typeof children === 'string' ? children : undefined)}>{children}</span> }
export function BookingDetail({ children, title, ...props }: HTMLAttributes<HTMLElement>) { return <span {...props} className={styles.detail} title={title ?? (typeof children === 'string' ? children : undefined)}>{children}</span> }

export function BookingSummary({ time, children }: { time: string; children: ReactNode }) {
  return <span className={styles.summary}><BookingTime>{time}</BookingTime><BookingDetail>{children}</BookingDetail></span>
}

export function BookingGap({ minutes, style }: { minutes: number; style?: CSSProperties }) {
  return <span className={styles.gap} style={style} aria-label={`次の予約まで空き${minutes}分`}>{minutes}分</span>
}

export function BookingNowLine({ time, direction = 'vertical', labelPosition = 'inline', style }: { time: string; direction?: 'vertical' | 'horizontal'; labelPosition?: 'inline' | 'above'; style?: CSSProperties }) {
  return <div className={styles.now} data-booking-now data-direction={direction} data-label-position={labelPosition} style={style} aria-label={`今 ${time}`}><span>{time}</span></div>
}

const compactBookingLabels: Partial<Record<BookingState, string>> = { active: '進行中', completed: '終了', pending: '要対応', attention: '重なり' }

/** 予約の箱の共通内容。名前と時刻を1段、メニューを2段目に置く。 */
export function BookingCardContent({ name, time, menu, state = 'confirmed', source, statusLabel, attention = false, children }: { name: string; time: string; menu: string; state?: BookingState; source?: string; sourceNote?: string | null; statusLabel?: string; attention?: boolean; children?: ReactNode }) {
  const label = statusLabel ?? bookingStateLabels[state]
  const shortLabel = label === bookingStateLabels[state] ? compactBookingLabels[state] ?? label : label
  return <><span className={styles.cardHeading}><BookingName title={name}>{name}</BookingName><BookingTime title={time}>{time}</BookingTime></span><span className={styles.cardDetails}><BookingDetail title={menu}>{menu}</BookingDetail><span className={styles.cardMeta}>{source === 'phone' ? <StatusBadge tone="neutral" dot={false} size="micro" data-booking-source>電話</StatusBadge> : null}{state !== 'confirmed' && state !== 'closed' ? <BookingStatus state={state} title={label}>{shortLabel}</BookingStatus> : null}{attention ? <BookingStatus state="attention" title={bookingStateLabels.attention}>重なり</BookingStatus> : null}{children}</span></span></>
}

/** 担当の名前から受付の決まりを確認する。違う決まりの人だけ札を添える。 */
export function BookingStaffHeading({ name, capacity, different = false, details }: { name: string; capacity?: number; different?: boolean; details?: ReactNode }) {
  return <span className={styles.staffHeading}><Avatar name={name} size={24} tone="soft" /><HelpTip hover label={`${name}の受付の決まり`} trigger={<strong>{name}</strong>}>{details ?? (capacity ? `同時に受付${capacity}人${capacity === 1 ? 'ずつ' : 'まで'}` : '受付数は未取得です')}</HelpTip>{different ? <StatusBadge tone="neutral" dot={false} size="micro">個別設定</StatusBadge> : null}</span>
}

/** 操作できる予約と区別する、共通の休憩表示。 */
export function BookingRest({ children = '休憩', title }: { children?: ReactNode; title?: string }) {
  return <span className={styles.rest} title={title ?? (typeof children === 'string' ? children : undefined)}>{title && title !== children ? <><span aria-hidden="true">{children}</span><span className="sr-only">{title}</span></> : children}</span>
}
