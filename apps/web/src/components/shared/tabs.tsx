'use client'

import Link from 'next/link'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './tabs.module.css'

export interface TabItem {
  /** タブの見出し。 */
  label: string
  /** 押したときの行き先。省くとボタンとして描く。 */
  href?: string
  /** 見出しの右に出す数。0 も出す（「0件ある」は情報なので隠さない）。 */
  count?: number
  /** いま開いているタブ。 */
  current?: boolean
  disabled?: boolean
  onClick?: () => void
  /**
   * このタブが切り替える面（tabpanel）の id。
   *
   * Issue #708（09/16）: タブと面を `aria-controls` で結ぶ。
   * 省いたタブには付けない（面を持たない行き先リンクのため）。
   */
  panelId?: string
}

/**
 * ページ内タブ。Pencil V5 の `VPn1F`（選択中）／`ISA1Q`（通常）。
 *
 * ★V5 227枚で 278回。共通メニューの次に多い部品。
 *
 * 形と色はここが持つ。**幅は持たない**。
 *
 * Issue #708（09 友だち追加時の配信・16 成果とアフィリエイト）:
 * 以前は `nav > button` に `aria-current` を付けただけの並びで、
 * `tablist/tab` が無く矢印キーでも動けなかった。見た目（要素・
 * クラス・CSS）は変えず、次の意味だけを足す。
 *
 * - 外の `span` が `role="tablist"`（名前は `label` で渡す）
 * - 各タブが `role="tab"`＋`aria-selected`（`aria-current` は残す。
 *   横スクロール部品が選択中タブの追従に読んでいるため）
 * - 選ばれていないタブは `tabIndex={-1}`（今のタブだけが Tab 停止点）
 * - 左右（上下）・Home・End キーで焦点を移す（押さずに移すだけ。
 *   行き先リンクのタブで勝手に遷移しないよう手動操作に留める）
 */
export function Tabs({
  items,
  actions,
  className,
  label,
}: {
  items: TabItem[]
  /**
   * タブ行の右端に置くもの。ヘッダー操作を独立した行にしないため
   * （`docs/v6-common-rules.md` §1-4、Pencil `aToSv` は space_between）。
   */
  actions?: ReactNode
  className?: string
  /**
   * タブ一覧の名前（`tablist` の accessible name）。
   * 省略しても描くが、読み上げでは「何の切替か」が伝わらないため、
   * 面を持つ画面（09/16）は必ず渡す。
   */
  label?: string
}) {
  const uid = useId()
  const listRef = useRef<HTMLSpanElement>(null)

  /**
   * 矢印キーでタブの間を動く（WAI-APG の手動操作タブ）。
   *
   * 焦点だけを移し、押したことにはしない。行き先リンクのタブで
   * 矢印のたびに遷移すると、端まで辿り着く前に画面が変わってしまう。
   * 決定は Enter・Space（素のリンク・ボタンのまま）に任せる。
   * 押せないタブ（`disabled`）は飛ばす。
   */
  const moveFocus = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (
      event.key !== 'ArrowLeft'
      && event.key !== 'ArrowRight'
      && event.key !== 'ArrowUp'
      && event.key !== 'ArrowDown'
      && event.key !== 'Home'
      && event.key !== 'End'
    ) {
      return
    }
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])') ?? [],
    )
    if (tabs.length === 0) return
    const active = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1
    const from = active === -1 ? tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true') : active
    let next: number
    if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = tabs.length - 1
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (from <= 0 ? tabs.length : from) - 1
    } else {
      next = (from === -1 || from >= tabs.length - 1) ? 0 : from + 1
    }
    event.preventDefault()
    tabs[next].focus()
  }

  return (
    <nav className={[styles.list, className].filter(Boolean).join(' ')}>
      <span
        ref={listRef}
        className={styles.items}
        role="tablist"
        aria-label={label}
        onKeyDown={moveFocus}
      >
        {items.map((item, index) => (
          <Tab key={item.label} id={`${uid}-tab-${index}`} {...item} />
        ))}
      </span>
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </nav>
  )
}

function Tab({
  id,
  label,
  href,
  count,
  current,
  disabled,
  onClick,
  panelId,
}: TabItem & { id: string }) {
  const classes = [styles.tab, current && styles.current].filter(Boolean).join(' ')
  const body: ReactNode = (
    <>
      {label}
      {count === undefined ? null : <span className={styles.count}>{count}</span>}
    </>
  )
  /*
   * タブの意味をそろえる。見た目（要素の種類分け・クラス）は
   * 従来のままにし、`role="tab"`＋`aria-selected`＋`tabIndex` を足す。
   * 今のタブだけが Tab の停止点（roving tabindex）で、他は矢印で届く。
   */
  const tabProps = {
    id,
    role: 'tab' as const,
    'aria-selected': Boolean(current),
    tabIndex: current ? 0 : -1,
    'aria-controls': panelId,
    className: classes,
  }

  if (href && !current && !disabled) {
    return (
      <Link href={href} {...tabProps} aria-current={current ? 'page' : undefined}>
        {body}
      </Link>
    )
  }

  /*
   * 今開いているタブに行き先が無いとき、以前は `disabled` 付きの
   * ボタンにしていた。押せないのは変わらないが、`disabled` の
   * ボタンには Tab も矢印も止まれず、タブ一覧の外へ焦点が逃げて
   * いた。見た目は `.tab:disabled` と同じまま、`aria-disabled` で
   * 「今ここ・押せない」を表し、焦点は止まれるようにする。
   */
  if (current && !onClick && !disabled) {
    return (
      <button
        type="button"
        {...tabProps}
        aria-current="page"
        aria-disabled="true"
      >
        {body}
      </button>
    )
  }

  return (
    <button
      type="button"
      {...tabProps}
      aria-current={current ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      onClick={onClick}
      disabled={disabled || (current && !onClick)}
    >
      {body}
    </button>
  )
}
