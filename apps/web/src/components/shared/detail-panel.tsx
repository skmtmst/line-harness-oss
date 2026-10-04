'use client'

import React, { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import styles from './detail-panel.module.css'

export type DetailPanelProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  /** 前・次の行へ。渡した方だけ上下キーとボタンが効く。 */
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  busy?: boolean
  children?: ReactNode
  footer?: ReactNode
}

/**
 * 右から出る詳細パネル（V8「サクサク感」C①）。窓（Drawer）の
 * 埋め込み面を土台にし、一覧は左に見えたままにする。↑↓で前・次の行、
 * Esc で閉じる。入力欄の中では上下キーを横取りしない。
 * V8 のときだけ開閉の動きが付く（drawer の V8 規定）。
 */
export default function DetailPanel({
  open,
  title,
  description,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  busy = false,
  children,
  footer,
}: DetailPanelProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const navRef = useRef({ onPrev, onNext, hasPrev, hasNext, busy })
  useEffect(() => {
    onCloseRef.current = onClose
    navRef.current = { onPrev, onNext, hasPrev, hasNext, busy }
  }, [onClose, onPrev, onNext, hasPrev, hasNext, busy])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      const nav = navRef.current
      if (nav.busy) return
      event.preventDefault()
      if (event.key === 'ArrowUp') {
        if (nav.onPrev && nav.hasPrev) nav.onPrev()
      } else if (nav.onNext && nav.hasNext) nav.onNext()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open ])

  if (!open) return null
  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      data-design-part="detail-panel"
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
        </div>
        <div className={styles.nav} role="group" aria-label="行の移動">
          <button type="button" className={styles.navButton} onClick={onPrev} disabled={!onPrev || !hasPrev || busy} aria-label="前の行">
            <ChevronUp aria-hidden="true" size={16} />
          </button>
          <button type="button" className={styles.navButton} onClick={onNext} disabled={!onNext || !hasNext || busy} aria-label="次の行">
            <ChevronDown aria-hidden="true" size={16} />
          </button>
          <button type="button" className={styles.navButton} onClick={onClose} disabled={busy} aria-label="閉じる">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </aside>
  )
}

/**
 * 行の詳細パネルと URL をつなぐ合図（C①「URL に今の行を残す」）。
 * `?key=id` を読み、変えると置き換える（履歴は増やさない）。
 * 戻る・進むでは `popstate` で追う。サーバ描画では読まない。
 */
export function useDetailPanelUrl(key: string): [string | null, (id: string | null) => void] {
  const read = useCallback((): string | null => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get(key)
  }, [key])
  const [current, setCurrent] = React.useState<string | null>(null)
  useEffect(() => {
    setCurrent(read())
    const onPopState = () => setCurrent(read())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [read])
  const change = useCallback(
    (id: string | null) => {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      if (id === null) url.searchParams.delete(key)
      else url.searchParams.set(key, id)
      window.history.replaceState(null, '', url)
      setCurrent(id)
    },
    [key],
  )
  return [current, change]
}
