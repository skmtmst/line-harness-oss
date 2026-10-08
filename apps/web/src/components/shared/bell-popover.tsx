'use client'

import { useEffect, useRef } from 'react'
import { Settings, Sparkles, TriangleAlert } from 'lucide-react'
import MenuPortal, { type MenuPortalRect } from './menu-portal'
import SegmentedControl from './segmented'
import IconButton from './icon-button'
import styles from './bell-popover.module.css'

export type BellFilter = 'all' | 'error' | 'update'

export type BellItem = {
  id: string
  title: string
  /** 本文。絵に無いので行の title（指を乗せると出る）に置く。 */
  body?: string
  category: 'error' | 'update'
  unread: boolean
  /** 「5分前」「昨日 18:20」など。 */
  time: string
  /** 行き先の言葉（「配信を開く」など。→ は部品が付ける）。 */
  linkLabel: string
}

export type BellPopoverState = 'loading' | 'ready' | 'error' | 'no-account'

export type BellPopoverProps = {
  open: boolean
  onClose: () => void
  /** 開くボタン（ベル）。外を押したかの判定と、Esc で焦点を戻す先。 */
  getAnchor: () => HTMLElement | null
  /** 位置の基準（上の帯の右端から 8 内側・帯の下）。省くとベルに合わせる。 */
  getPositionRect?: () => MenuPortalRect | null
  id?: string
  state: BellPopoverState
  /** 見せる行（呼ぶ側で未読が先・新しい順にし、5件までに切る）。 */
  items: BellItem[]
  unreadCount: number
  filter: BellFilter
  onFilterChange: (filter: BellFilter) => void
  errorMessage?: string
  onRetry?: () => void
  onSelect: (id: string) => void
  onMarkAllRead: () => void
  onViewAll: () => void
  onOpenSettings: () => void
}

const FILTERS: { value: BellFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'error', label: 'エラー' },
  { value: 'update', label: 'アップデート' },
]

/**
 * ★V8 上の帯のベルを押したときのお知らせの小窓（V8.pen `DIHFx/D2eAyQ`・小窓 `mV28V`）。
 *
 * ページを移らずにベルの下へ出す（role="dialog"・モーダルではない）。
 * 外を押す・Esc で閉じ、Esc のときは焦点をベルへ戻す。
 * 中身（取得・既読）は呼ぶ側が持つ。ここは見た目と開閉だけ。
 */
export default function BellPopover({
  open,
  onClose,
  getAnchor,
  getPositionRect,
  id,
  state,
  items,
  unreadCount,
  filter,
  onFilterChange,
  errorMessage,
  onRetry,
  onSelect,
  onMarkAllRead,
  onViewAll,
  onOpenSettings,
}: BellPopoverProps) {
  const panelRef = useRef<HTMLElement>(null)

  // 開いたら小窓へ焦点を移す（読み上げは「お知らせ ダイアログ」）。
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  // Esc は器（MenuPortal）も閉じる。ここは焦点をベルへ戻す分。
  // 器の閉じる処理より先に動くよう捕捉の段で受ける（後だと小窓が先に消え、
  // この受け手も外れて焦点が body に落ちる。実ブラウザで確認）。
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
        aria-label="お知らせ"
        tabIndex={-1}
        className={styles.panel}
        data-design-node="mV28V"
      >
        <header className={styles.head}>
          <h2 className={styles.title}>お知らせ</h2>
          {state === 'ready' ? <span className={styles.unread}>{`未読 ${unreadCount}`}</span> : null}
          {state === 'ready' ? (
            <button type="button" className={styles.markAll} onClick={onMarkAllRead} disabled={unreadCount === 0}>
              すべて既読にする
            </button>
          ) : null}
        </header>

        {state !== 'no-account' ? (
          <div className={styles.filters}>
            <SegmentedControl
              aria-label="お知らせの種類"
              size="compact"
              options={FILTERS}
              value={filter}
              onChange={onFilterChange}
            />
          </div>
        ) : null}

        {state === 'loading' ? (
          <p className={styles.state} role="status">読み込み中…</p>
        ) : state === 'no-account' ? (
          <p className={styles.state}>LINEアカウントを選ぶと、そのアカウントのお知らせが出ます。</p>
        ) : state === 'error' ? (
          <div className={styles.state} role="alert">
            <span>{errorMessage || 'お知らせを読み込めませんでした。'}</span>
            {onRetry ? <button type="button" className={styles.retry} onClick={onRetry}>もう一度</button> : null}
          </div>
        ) : items.length === 0 ? (
          <p className={styles.state}>お知らせはまだありません。</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.item} data-unread={item.unread}>
                <button type="button" className={styles.row} onClick={() => onSelect(item.id)} title={item.body || undefined}>
                  <span className={styles.icon} data-category={item.category} aria-hidden="true">
                    {item.category === 'error' ? <TriangleAlert /> : <Sparkles />}
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
        )}

        <footer className={styles.foot}>
          <button type="button" className={styles.viewAll} onClick={onViewAll}>すべて見る →</button>
          <IconButton className={styles.settings} onClick={onOpenSettings} aria-label="通知設定" title="通知設定">
            <Settings aria-hidden="true" />
          </IconButton>
        </footer>
      </section>
    </MenuPortal>
  )
}
