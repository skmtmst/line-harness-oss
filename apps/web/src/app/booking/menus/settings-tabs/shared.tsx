'use client'

/* タブ共通（書きかけ登録・小さな部品・定数）（settings-v8.tsx から分割。見た目・動きは変えない） */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { type BookingMenu, type BookingSettings } from '@/lib/api'
import styles from '../settings-v8.module.css'

export type LoadStatus = 'loading' | 'ready' | 'error'

export const MENU_PAGE_SIZE = 6

export const DAYS = [
  { weekday: 1, label: '月曜日' },
  { weekday: 2, label: '火曜日' },
  { weekday: 3, label: '水曜日' },
  { weekday: 4, label: '木曜日' },
  { weekday: 5, label: '金曜日' },
  { weekday: 6, label: '土曜日' },
  { weekday: 0, label: '日曜日' },
] as const
export const WEEKDAY_JP = '日月火水木金土'

export const JST_OFFSET_MS = 9 * 3600_000

export type BusinessHoursDay = BookingSettings['businessHours'][number]
export type BusinessHourInterval = BusinessHoursDay['intervals'][number]

/* ==================== タブの「書きかけ」をシェルへ渡す ==================== */

export type V8TabEdit = {
  dirty: boolean
  saving: boolean
  /** 離脱確認の題名（「○○への変更」）。 */
  subject: string
  saveLabel?: string
  saveDisabled?: boolean
  /** false のとき保存帯は出さず、離脱確認だけ使う（休業日の窓など）。 */
  showBar?: boolean
  onSave: () => void
  onReset: () => void
}

export const V8TabEditContext = createContext<(next: V8TabEdit | null) => void>(() => {})

/**
 * タブ内の書きかけ状態をシェルへ登録する。dirty / saving / subject の
 * 変わったときだけ登録し直すので、描画ごとの更新でループしない。
 */
export function useV8TabEdit(input: V8TabEdit) {
  const register = useContext(V8TabEditContext)
  const ref = useRef(input)
  ref.current = input
  const { dirty, saving, subject, saveDisabled, showBar } = input
  useEffect(() => {
    register({
      dirty,
      saving,
      subject,
      saveLabel: ref.current.saveLabel,
      saveDisabled,
      showBar: showBar ?? true,
      onSave: () => ref.current.onSave(),
      onReset: () => ref.current.onReset(),
    })
    return () => register(null)
  }, [register, dirty, saving, subject, saveDisabled, showBar])
}

/* ==================== 小さな部品 ==================== */

export function Band({ tone, children }: { tone: 'hint' | 'warn'; children: ReactNode }) {
  return (
    <p className={tone === 'warn' ? styles.warnBand : styles.hintBand}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="5.6" />
        <path d="M7 6.2v3" strokeLinecap="round" />
        <circle cx="7" cy="4.1" r="0.9" fill="currentColor" stroke="none" />
      </svg>
      <span>{children}</span>
    </p>
  )
}

export function StateCard({ icon, title, description, action }: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className={styles.stateCard} data-design-node="xCoDe">
      <span className={styles.stateIcon} aria-hidden="true">{icon}</span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateDesc}>{description}</p>
      {action ? <div className={styles.stateActions}>{action}</div> : null}
    </div>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.skeletonRows} aria-label="読み込み中" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonBar} />
          <span className={`${styles.skeletonBar} ${styles.skeletonBarShort}`} />
        </div>
      ))}
    </div>
  )
}

export function AccountIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="16" height="14" rx="2" />
      <path d="M3 8h16" />
    </svg>
  )
}

/** `YYYY-MM-DD` に n 日足す。 */
export function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function sortedMenus(menus: BookingMenu[]): BookingMenu[] {
  return [...menus].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}
