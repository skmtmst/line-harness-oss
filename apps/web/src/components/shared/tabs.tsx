import Link from 'next/link'
import type { KeyboardEvent, ReactNode } from 'react'
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
}

/**
 * ページ内タブ。Pencil V5 の `VPn1F`（選択中）／`ISA1Q`（通常）。
 *
 * ★V5 227枚で 278回。共通メニューの次に多い部品。
 *
 * 形と色はここが持つ。**幅は持たない**。
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
   * タブの並び全体を読み上げる名前（Issue #708）。例:「配信の種類」。
   * 読み上げソフトが「○○のタブ一覧」と伝えられるようにする。
   */
  label?: string
}) {
  /*
   * Issue #708（監査6 a11y）: タブは見た目どおり tablist/tab の役割を持つ。
   * 選択中は aria-selected で伝え、Tabキーで入れるのは選択中の1つだけに
   * 絞る（roving tabindex）。左右の矢印キーで隣のタブへ移動できる
   * （フォーカスだけ動かし、開くのは Enter/Space/クリック＝手動起動型）。
   */
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    const { key } = event
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return
    const list = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')
    const tabs = Array.from(list)
    const current = tabs.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    event.preventDefault()
    const next =
      key === 'Home' ? 0
      : key === 'End' ? tabs.length - 1
      : key === 'ArrowRight' ? (current + 1) % tabs.length
      : (current - 1 + tabs.length) % tabs.length
    tabs[next]?.focus()
  }

  return (
    <nav className={[styles.list, className].filter(Boolean).join(' ')}>
      <span
        className={styles.items}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={moveFocus}
      >
        {items.map((item, index) => (
          // 選択中のタブに Tab キーで入れるようにする（roving tabindex）。
          // どれも選ばれていないときは先頭が入口になる。
          <Tab
            key={item.label}
            {...item}
            tabIndex={item.current ? 0 : items.some((i) => i.current) ? -1 : index === 0 ? 0 : -1}
          />
        ))}
      </span>
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </nav>
  )
}

function Tab({ label, href, count, current, disabled, onClick, tabIndex }: TabItem & { tabIndex: number }) {
  const classes = [styles.tab, current && styles.current].filter(Boolean).join(' ')
  const body: ReactNode = (
    <>
      {label}
      {count === undefined ? null : <span className={styles.count}>{count}</span>}
    </>
  )
  /*
   * aria-current は見た目の選択位置を追う既存の印として残す
   * （scrollable-tabs がこの属性で選択中のタブへスクロールする）。
   * 選択の意味は role="tab" + aria-selected が持つ。
   */
  const shared = {
    className: classes,
    role: 'tab',
    'aria-selected': current ?? false,
    'aria-current': current ? ('page' as const) : undefined,
    tabIndex,
  }

  if (href && !current && !disabled) {
    return (
      <Link href={href} {...shared}>
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      {...shared}
      aria-disabled={disabled || undefined}
      onClick={onClick}
      /*
       * 選択中・onClick無しのタブは押せないが disabled にはしない。
       * disabled のボタンはフォーカスを受けられず、選択中のタブへ
       * Tab キーで入れなくなるため（Issue #708）。
       */
      disabled={disabled}
    >
      {body}
    </button>
  )
}
