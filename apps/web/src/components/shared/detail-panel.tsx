'use client'

import React, { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import styles from './detail-panel.module.css'
import { isImeComposing } from './ime'

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
 * キーが詳細パネル以外の面から来たか。そこでのキーはその面のもの。
 * - 開いている面（メニュー・候補の一覧・別の窓）：Esc も上下も、その面を閉じる・動かすだけ。
 * - 自分で上下を使う部品（選ぶ箱・タブの並び・丸の選択など）：上下だけその部品のもの（Esc は閉じてよい）。
 */
const POPUP_SURFACE = ['[data-menu-portal]', '[role="menu"]', '[role="menubar"]', '[role="listbox"]'].join(',')
const ARROW_SURFACE = [
  POPUP_SURFACE,
  '[role="combobox"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(',')

function fromOtherSurface(target: Element | null, panel: HTMLElement | null, key: string): boolean {
  if (!target) return false
  if (target.closest(key === 'Escape' ? POPUP_SURFACE : ARROW_SURFACE)) return true
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]')
  return Boolean(dialog && dialog !== panel && !dialog.contains(panel))
}

/**
 * 右から出る詳細パネル（V8「サクサク感」C①）。窓（Drawer）の
 * 埋め込み面を土台にし、一覧は左に見えたままにする。↑↓で前・次の行、
 * Esc で閉じる。入力欄の中では上下キーを横取りしない。ほかの部品が処理したキー・
 * 別の面（メニュー・候補・別の窓）からのキー・変換中のキーは触らず、保存中（busy）は閉じない。
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
      if (event.key !== 'Escape' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      // ほかの部品（「…」のメニュー・選ぶ箱など）が先に処理したキー・日本語の変換中のキーは触らない。
      if (event.defaultPrevented || isImeComposing(event)) return
      const target = event.target instanceof Element ? event.target : null
      if (fromOtherSurface(target, panelRef.current, event.key)) return
      const nav = navRef.current
      if (event.key === 'Escape') {
        // 開いているメニューの Esc はメニューを閉じるだけ。保存中は閉じない（書きかけを失わない）。
        if (document.querySelector('[data-menu-portal]') || nav.busy) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
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
