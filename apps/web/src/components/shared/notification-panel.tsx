'use client'

import React, { useEffect, useRef } from 'react'
import { ChevronRight, Settings } from 'lucide-react'
import MenuPortal from './menu-portal'
import styles from './notification-panel.module.css'

export type NotificationFilter = { id: string; label: string; count: number | null }
export type NotificationItem = {
  id: string
  title: string
  meta: string
  unread?: boolean
  filterId?: string
  onSelect?: () => void
}

export type NotificationPanelProps = {
  open: boolean
  items: NotificationItem[]
  filters: NotificationFilter[]
  activeFilter: string
  unreadCount: number
  loading?: boolean
  error?: string
  onFilterChange: (id: string) => void
  onMarkAllRead: () => void
  onClose?: () => void
  onViewAll?: () => void
  onOpenSettings?: () => void
  inline?: boolean
  /** 開くボタンの器。渡すと最上層（portal）に出す。 */
  getAnchor?: () => HTMLElement | null
}

/** Pencil V5 `z6TmF` を正本にした通知センターの開状態。 */
export default function NotificationPanel({
  open,
  items,
  filters,
  activeFilter,
  unreadCount,
  loading = false,
  error,
  onFilterChange,
  onMarkAllRead,
  onClose,
  onViewAll,
  onOpenSettings,
  inline = false,
  getAnchor,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // 最上層（portal）のときは MenuPortal が外側・Esc を見る。
  useEffect(() => {
    if (!open || inline || !onClose || getAnchor) return
    const closeOutside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [getAnchor, inline, onClose, open])

  if (!open) return null
  const shown = activeFilter === 'all' ? items : items.filter((item) => item.filterId === activeFilter)
  // 参照画像の固定比較（`inline`）・基準が無いとき以外は、最上層に出す。
  const portal = !inline && getAnchor && onClose

  const body = (
    <section
      ref={panelRef}
      className={`${styles.panel} ${inline ? styles.inline : ''}`}
      aria-label="通知"
      tabIndex={-1}
      data-design-part="notification-panel"
      data-design-node="z6TmF"
      // 最上層では absolute 指定を無効にする（位置は器が決める）。
      style={portal ? { position: 'static' } : undefined}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>通知</h2>
        <button type="button" className={styles.linkButton} onClick={onMarkAllRead} disabled={unreadCount === 0}>すべて既読にする</button>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="通知の種類">
        {filters.map((filter) => <button key={filter.id} type="button" role="tab" aria-selected={activeFilter === filter.id} className={`${styles.tab} ${activeFilter === filter.id ? styles.selected : ''}`} onClick={() => onFilterChange(filter.id)}>{filter.label} <span className={styles.count}>{filter.count === null ? '—' : filter.count}</span></button>)}
      </div>
      {loading ? <p className={styles.state}>通知を読み込んでいます…</p> : error ? <p className={`${styles.state} ${styles.error}`} role="alert">{error}</p> : shown.length === 0 ? <p className={styles.state}>通知はありません</p> : (
        <ul className={styles.list}>{shown.map((item) => <li key={item.id}><button type="button" className={`${styles.item} ${styles.notificationItem} ${item.unread ? styles.unread : ''}`} onClick={item.onSelect}><span className={styles.dot} aria-label={item.unread ? '未読' : '既読'} /><span className={styles.body}><span className={styles.itemTitle}>{item.title}</span><span className={styles.meta}>{item.meta}</span></span><ChevronRight className={styles.chevron} aria-hidden="true" size={16} /></button></li>)}</ul>
      )}
      <footer className={`${styles.footer} ${styles.notificationFooter}`}>
        <button type="button" className={styles.linkButton} onClick={onViewAll}>すべての通知を見る →</button>
        <button type="button" className={`${styles.linkButton} ${styles.settings}`} onClick={onOpenSettings}><Settings aria-hidden="true" size={14} />通知設定</button>
      </footer>
    </section>
  )

  if (portal && getAnchor && onClose) {
    return (
      <MenuPortal open={open} getAnchor={getAnchor} onClose={onClose}>
        {body}
      </MenuPortal>
    )
  }
  return body
}
