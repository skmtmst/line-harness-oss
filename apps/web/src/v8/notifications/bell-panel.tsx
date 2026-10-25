'use client'

import { useEffect, useRef } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import MenuPortal, { type MenuPortalRect } from '@/components/shared/menu-portal'
import SegmentedControl from '@/components/shared/segmented'
import styles from '@/components/shared/bell-popover.module.css'
import { NOTIFICATION_TABS, type NotificationTab } from './tabs'

export type BellPanelItem = {
  id: string
  title: string
  /** 本文。絵に無いので行の title（指を乗せると出る）に置く。 */
  body?: string
  /** 印の形。システムの知らせは三角、それ以外は光。 */
  kind: 'system' | 'other'
  unread: boolean
  /** 「5分前」「昨日 18:20」など。 */
  time: string
  /** 作成日時を日本時間で分けた日付の組。日時が不正なら不明として残す。 */
  period: 'today' | 'earlier' | 'unknown'
  /** 行き先の言葉（「配信を開く」「更新する」など。→ は部品が付ける）。 */
  linkLabel: string
}

export type BellPanelState = 'loading' | 'ready' | 'error' | 'no-account'

export type BellPanelProps = {
  open: boolean
  onClose: () => void
  /** 開くボタン（ベル）。外を押したかの判定と、Esc で焦点を戻す先。 */
  getAnchor: () => HTMLElement | null
  getPositionRect?: () => MenuPortalRect | null
  id?: string
  state: BellPanelState
  /** 見せる行（呼ぶ側で未読が先・新しい順にし、5件までに切る）。 */
  items: BellPanelItem[]
  unreadCount: number
  tab: NotificationTab
  onTabChange: (tab: NotificationTab) => void
  errorMessage?: string
  onRetry?: () => void
  onSelect: (id: string) => void
  onMarkAllRead?: () => void
  onViewAll: () => void
}

const PERIODS: { value: BellPanelItem['period']; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'earlier', label: 'それより前' },
  { value: 'unknown', label: '日時不明' },
]

const EMPTY: Record<NotificationTab, string> = {
  all: '通知はまだありません。',
  unread: '未読の通知はありません。',
  system: 'システムの通知はありません。',
}

/**
 * 上の帯のベルを押したときの通知の小窓（V8.pen 小窓 `mV28V`）。
 *
 * 見た目は共通の小窓（`components/shared/bell-popover`）と同じ器と CSS を使い、
 * タブだけ「すべて・未読・システム」にする（共通の小窓はタブを差し替えられないため、ここで包む）。
 * ページを移らずにベルの下へ出す（role="dialog"・モーダルではない）。
 * 外を押す・Esc で閉じ、Esc のときは焦点をベルへ戻す。中身（取得・既読）は呼ぶ側が持つ。
 */
export default function BellPanel({
  open,
  onClose,
  getAnchor,
  getPositionRect,
  id,
  state,
  items,
  unreadCount,
  tab,
  onTabChange,
  errorMessage,
  onRetry,
  onSelect,
  onMarkAllRead,
  onViewAll,
}: BellPanelProps) {
  const panelRef = useRef<HTMLElement>(null)

  // 開いたら小窓へ焦点を移す（読み上げは「通知 ダイアログ」）。
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  // Esc は器（MenuPortal）も閉じる。器より先に動くよう捕捉の段で受け、焦点をベルへ戻す。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      getAnchor()?.focus()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose, getAnchor])

  return (
    <MenuPortal open={open} getAnchor={getAnchor} getPositionRect={getPositionRect} align="end" onClose={onClose}>
      <section
        ref={panelRef}
        id={id}
        role="dialog"
        aria-label="通知"
        tabIndex={-1}
        className={styles.panel}
        data-design-node="mV28V"
      >
        <header className={styles.head}>
          <h2 className={styles.title}>通知</h2>
          {state === 'ready' ? <span className={styles.unread}>{`未読 ${unreadCount}`}</span> : null}
          {state === 'ready' && onMarkAllRead ? (
            <button type="button" className={styles.markAll} onClick={onMarkAllRead} disabled={unreadCount === 0}>
              すべて既読にする
            </button>
          ) : null}
        </header>

        {state !== 'no-account' ? (
          <div className={styles.filters}>
            <SegmentedControl
              aria-label="通知の種類"
              size="compact"
              options={NOTIFICATION_TABS}
              value={tab}
              onChange={onTabChange}
            />
          </div>
        ) : null}

        {state === 'loading' ? (
          <p className={styles.state} role="status">読み込み中…</p>
        ) : state === 'no-account' ? (
          <p className={styles.state}>LINEアカウントを選ぶと、そのアカウントの通知が出ます。</p>
        ) : state === 'error' ? (
          <div className={styles.state} role="alert">
            <span>{errorMessage || '通知を読み込めませんでした。'}</span>
            {onRetry ? <button type="button" className={styles.retry} onClick={onRetry}>もう一度</button> : null}
          </div>
        ) : items.length === 0 ? (
          <p className={styles.state}>{EMPTY[tab]}</p>
        ) : (
          <div>
            {PERIODS.map((period) => {
              const rows = items.filter(item => item.period === period.value)
              if (rows.length === 0) return null
              return <section key={period.value} aria-label={period.label}>
                <h3 className={styles.period}>{period.label}</h3>
                <ul className={styles.list}>
                  {rows.map((item) => (
                    <li key={item.id} className={styles.item} data-unread={item.unread}>
                      <button type="button" className={styles.row} onClick={() => onSelect(item.id)} title={item.body || undefined}>
                        <span className={styles.icon} data-category={item.kind === 'system' ? 'error' : 'update'} aria-hidden="true">
                          {item.kind === 'system' ? <TriangleAlert /> : <Sparkles />}
                        </span>
                        <span className={styles.text}>
                          <span className={styles.itemTitle}>
                            {item.title}
                            {item.unread ? <span className="sr-only">（未読）</span> : null}
                          </span>
                          <span className={styles.meta}>
                            <span className={styles.time}>{item.time}</span>
                            <span className={styles.go}>{`${item.linkLabel} →`}</span>
                          </span>
                        </span>
                        {item.unread ? <span className={styles.dot} aria-hidden="true" /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            })}
          </div>
        )}

        {/* 下は「すべて見る」だけ。通知設定はその先の通知の画面にある。 */}
        <footer className={styles.foot}>
          <button type="button" className={styles.viewAll} onClick={onViewAll}>すべて見る →</button>
        </footer>
      </section>
    </MenuPortal>
  )
}
