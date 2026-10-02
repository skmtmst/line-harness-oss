'use client'

/*
 * 成果とアフィリエイト V8-B（板 nJlxX 系）の中で共有する小さい部品。
 *
 * - `KpiStrip` / `KpiCell`：数の帯（高さ115・細い線で区切る）。右上の「…」は
 *   押すと数え方の説明が出る（飾りにしない）。
 * - `NoticeBar`：案内・注意の帯。
 * - `StateCard`：まだ無い・絞り込み0件・読み込み中・読み込めなかったの4態。
 *   どのタブでも同じ骨組み・同じ高さで出す（板 `rRk0C`）。
 * - `BulkBar`：行を選んだとき下から出る浮き帯（板 `OylSV`）。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Eye, Info, Loader2, MoreHorizontal, TriangleAlert, X } from 'lucide-react'
import Button from '@/components/shared/button'
import styles from './list-v8.module.css'

// ─────────────────────────────────────────────────────────────────────────────
// 数の帯
// ─────────────────────────────────────────────────────────────────────────────

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className={styles.kpiStrip} role="group" aria-label="今の数">{children}</div>
}

/** KPI の右上「…」。数え方の説明を開く。説明が無いときは描かない。 */
function KpiInfo({ text, label }: { text?: string; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!text) return null
  return (
    <span className={styles.kpiInfo} ref={ref}>
      <button
        type="button"
        className={styles.kpiInfoButton}
        aria-label={`${label}の数え方`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      {open ? <span className={styles.kpiInfoPopover} role="note">{text}</span> : null}
    </span>
  )
}

export function KpiCell({
  icon,
  label,
  value,
  unit,
  sub,
  info,
}: {
  icon?: ReactNode
  label: string
  /** `null` は「取れていない」。`—` を出す。0 もれなく 0 を出す。 */
  value: ReactNode
  unit?: string
  sub?: ReactNode
  /** 「…」から開く数え方の説明。 */
  info?: string
}) {
  return (
    <div className={styles.kpiCell}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>{icon}{label}</span>
        <KpiInfo text={info} label={label} />
      </div>
      <div className={styles.kpiValue}>
        {value == null ? '—' : value}
        {value != null && unit ? <span className={styles.kpiUnit}>{unit}</span> : null}
      </div>
      {sub ? <p className={styles.kpiSub}>{sub}</p> : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 案内・注意の帯
// ─────────────────────────────────────────────────────────────────────────────

export function NoticeBar({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn'
  children: ReactNode
}) {
  const Icon = tone === 'warn' ? TriangleAlert : Info
  return (
    <div className={`${styles.notice} ${tone === 'warn' ? styles.noticeWarn : ''}`} role="status">
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

/** 閲覧のみの帯（板 `v9JWQ`：タブの段の下、上に12のすき間）。 */
export function ReadOnlyBand() {
  return (
    <div className={styles.roBand} role="status">
      <Eye size={16} aria-hidden="true" />
      <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 状態カード（板 `rRk0C`）
// ─────────────────────────────────────────────────────────────────────────────

/** 「まだ無い」：印＋題＋説明＋主ボタン。 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className={styles.stateWrap}>
      <div className={styles.stateCard}>
        {icon ? <span className={styles.stateIcon}>{icon}</span> : null}
        <p className={styles.stateTitle}>{title}</p>
        <p className={styles.stateDesc}>{description}</p>
        {action ? <div className={styles.stateActions}>{action}</div> : null}
      </div>
    </div>
  )
}

/** 「絞り込みで0件」：条件を外す入口つき。 */
export function ZeroResultState({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.stateWrap}>
      <div className={styles.stateCard}>
        <p className={styles.stateTitle}>条件に合うものはありません</p>
        <p className={styles.stateDesc}>検索や絞り込みを外すと、すべて出ます</p>
        <div className={styles.stateActions}>
          <Button type="button" onClick={onReset}>
            <X size={14} aria-hidden="true" /> 条件を外す
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 「読み込み中」：表の形の骨組みを出す（高さが跳ねないように）。 */
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.stateWrap} role="status" aria-label="読み込み中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skelRow} aria-hidden="true">
          <span className={styles.skelDot} />
          <span className={styles.skelBar} style={{ width: '22%' }} />
          <span className={styles.skelBar} style={{ width: '14%' }} />
          <span className={styles.skelBar} style={{ width: '18%' }} />
          <span className={styles.skelBar} style={{ width: '10%', marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

/** 「読み込めなかった」：赤い帯＋もう一度。道具はそのまま使える。 */
export function LoadError({ name, onRetry }: { name: string; onRetry: () => void }) {
  return (
    <div className={styles.stateWrap}>
      <div className={styles.errorBand}>
        <AlertCircle size={16} aria-hidden="true" />
        <span>{name}を読み込めませんでした</span>
        <span className={styles.errorRetry}>
          <Button type="button" onClick={onRetry}>
            <Loader2 size={14} aria-hidden="true" /> もう一度試す
          </Button>
        </span>
      </div>
      <p className={styles.errorNote}>
        数の帯は「—」にしています。道具はそのまま使えます（条件を変えてから試し直せます）。
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// まとめ操作の浮き帯（板 `OylSV`）
// ─────────────────────────────────────────────────────────────────────────────

export function BulkBar({
  count,
  hint,
  actionLabel,
  onAction,
  onClear,
}: {
  count: number
  hint?: string
  actionLabel: string
  onAction: () => void
  onClear: () => void
}) {
  if (count <= 0) return null
  return (
    <div className={styles.bulkBar} role="region" aria-label="選択中のまとめ操作">
      <span className={styles.bulkCount}>{count}</span>
      <span className={styles.bulkHint}>{hint ?? '件を選択中　対象を確認してから操作を選んでください'}</span>
      <span className={styles.bulkActions}>
        <Button type="button" onClick={onAction}>☰ {actionLabel}</Button>
        <button
          type="button"
          className={styles.kpiInfoButton}
          aria-label="選択を解除する"
          onClick={onClear}
          style={{ width: 28, height: 28 }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </span>
    </div>
  )
}
