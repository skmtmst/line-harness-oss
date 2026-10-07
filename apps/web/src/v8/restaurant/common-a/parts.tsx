'use client'

/*
 * ★V8 飲食店向けの板に共通の小さな部品（担当 a の画面だけで使う）。
 * - 数のカード（CHz31「数の並び」）：共通の KpiCard を絵の寸法で使う
 * - 白い枠（CHz31「枠 店舗一覧」）：題14/700・説明11・右端の注意、下に細い線
 * - 状態の札：共通の StatusBadge（点＋文字）
 */
import type { ReactNode } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import styles from './parts.module.css'

const statusLabel: Record<string, string> = {
  connected: '正常', active: '有効', invited: '招待中', suspended: '停止中', archived: '保管済', approved: '承認済', completed: '完了', visited: '来店済',
  confirmed: '予約確定', warning: '要確認', pending: '承認待ち', draft: '下書き', scheduled: '予約済',
  unreplied: '未返信', unconfigured: '未設定', disabled: '無効', error: 'エラー', returned: '差戻し',
  seated: '来店中', cancelled: '取消', no_show: '無断キャンセル', preview_only: 'プレビューのみ',
}

export function statusTone(value: string): StatusBadgeTone {
  if (['connected', 'active', 'approved', 'completed', 'visited', 'confirmed'].includes(value)) return 'success'
  if (['warning', 'pending', 'draft', 'scheduled', 'unreplied'].includes(value)) return 'warning'
  if (['error', 'no_show', 'cancelled'].includes(value)) return 'danger'
  return 'neutral'
}

/** 板の「状態の札」（点＋文字）。 */
export function Status({ value, label }: { value: string; label?: string }) {
  return <StatusBadge tone={statusTone(value)} className={styles.status}>{label ?? statusLabel[value] ?? value}</StatusBadge>
}

/** 数のカード。値は単位まで1つの文字で渡す（例「38件」）。 */
export function Stat({ label, value, note, warning = false, help, size = 'regular' }: {
  label: string
  value: string
  note: ReactNode
  /** 注意を促す数（未返信口コミなど）は琥珀色。 */
  warning?: boolean
  help?: ReactNode
  /** small は数が 20px（LINE来店フォロー xLpnS の6つ並び）。 */
  size?: 'regular' | 'small'
}) {
  const jp = /[\u3000-\u9fff\uff00-\uffef]/.test(value)
  return (
    <KpiCard
      className={`${styles.stat} ${jp ? styles.statJp : ''} ${size === 'small' ? styles.statSmall : ''}`}
      title={label}
      icon={null}
      value={null}
      unit=""
      valueText={value}
      valueTone={warning ? 'warning' : 'default'}
      detail={note}
      help={help}
    />
  )
}

/** 数のカードの並び（間12・同じ幅）。 */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className={styles.stats}>{children}</div>
}

/** 白い枠。flush は表など枠いっぱいの中身（内側の余白なし）。 */
export function Panel({ title, description, aside, flush = false, narrow = false, children }: {
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  flush?: boolean
  /** 幅を絵の列の幅（280）に固定する（組織階層）。 */
  narrow?: boolean
  children?: ReactNode
}) {
  return (
    <section className={`${styles.panel} ${narrow ? styles.panelNarrow : ''}`}>
      <div className={styles.panelHead}>
        <div className={styles.panelHeadText}>
          <h2 className={styles.panelTitle}>{title}</h2>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {aside}
      </div>
      {children === undefined ? null : flush ? children : <div className={styles.panelBody}>{children}</div>}
    </section>
  )
}

export function PanelAside({ tone = 'warning', children }: { tone?: 'warning' | 'success'; children: ReactNode }) {
  return <span className={`${styles.panelAside} ${tone === 'success' ? styles.panelAsideOk : ''}`}>{children}</span>
}

/** 2つ並びの枠（全店アクション／同期方針）。 */
export function HalfGrid({ children }: { children: ReactNode }) {
  return <div className={styles.halfGrid}>{children}</div>
}

/** 年/月/日 時:分（絵の「2026/09/30 10:12」）。 */
export function formatStamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
