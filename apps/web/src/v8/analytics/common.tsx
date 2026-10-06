'use client'

/* ★V8 分析の見かたで共通に使う小さな部品（期間の切り替え・数の帯の「…」・日時の短い形）。 */
import { useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import SegmentedControl from '@/components/shared/segmented'
import { RANGES } from './parts'
import styles from './analytics.module.css'

/** 期間の切り替え（7日・30日・90日）。small はカードの中（器3・項目 5/14）、medium は道具の段。 */
export function RangePickerV8({ days, onChange, size = 'medium' }: { days: number; onChange: (days: number) => void; size?: 'small' | 'medium' }) {
  return <SegmentedControl size={size} className={size === 'small' ? styles.range : undefined} aria-label="集計期間" options={RANGES.map((range) => ({ value: String(range), label: `${range}日` }))} value={String(days)} onChange={(value) => onChange(Number(value))} />
}

/** 数の帯の「…」。この見かたで使える操作だけ（いまは CSV の書き出し）。 */
export function KpiMenu({ title, label = 'CSV で書き出す', onExport, disabled }: { title: string; label?: string; onExport: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return <span className={styles.kpiMenu}>
    <IconButton className={styles.kpiMenuButton} aria-label={`${title}の操作`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={16} aria-hidden="true" /></IconButton>
    <ActionMenu open={open} onClose={() => setOpen(false)} ariaLabel={`${title}の操作`} items={[{ id: 'csv', label, disabled, onSelect: () => { setOpen(false); onExport() } }]} />
  </span>
}

const JST = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false })
const JST_DAY = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })
/** 「9/30 19:00」（日本時間）。 */
export function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(JST.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}
/** 「9/30」（日本時間）。YYYY-MM-DD も日時も受ける。 */
export function shortDay(value: string | null): string {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(JST_DAY.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.month}/${parts.day}`
}
/** 道具の段の「9/2〜10/1・10/1 6:00 までのデータ」。 */
export function dataRangeCaption(from: string, to: string, cutoffAt: string): string {
  return `${shortDay(from)}〜${shortDay(to)}・${shortDateTime(cutoffAt)} までのデータ`
}

/** 表の状態の札（点＋文字・丸い地）。緑＝動いている・灰＝止めている・青＝案内。 */
export function StatePill({ tone, children }: { tone: 'ok' | 'neutral' | 'info' | 'warn'; children: ReactNode }) {
  return <span className={styles.pill} data-tone={tone}>{children}</span>
}
