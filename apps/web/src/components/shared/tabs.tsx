import Link from 'next/link'
import type { ReactNode } from 'react'
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
}: {
  items: TabItem[]
  /**
   * タブ行の右端に置くもの。ヘッダー操作を独立した行にしないため
   * （`docs/v6-common-rules.md` §1-4、Pencil `aToSv` は space_between）。
   */
  actions?: ReactNode
  className?: string
}) {
  /*
   * ★V7: ボタンで切り替えるタブ（href が無いもの）があるときだけ、
   * 中の並びを tablist にする。リンクで移動するタブは行き先の案内なので
   * aria-current="page" のままで、role="tab" は付けない。
   */
  const buttonMode = items.some((item) => !item.href)
  return (
    <nav className={[styles.list, className].filter(Boolean).join(' ')}>
      <span className={styles.items} role={buttonMode ? 'tablist' : undefined}>
        {items.map((item) => (
          <Tab key={item.label} {...item} />
        ))}
      </span>
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </nav>
  )
}

function Tab({ label, href, count, current, disabled, onClick }: TabItem) {
  const classes = [styles.tab, current && styles.current].filter(Boolean).join(' ')
  const body: ReactNode = (
    <>
      {label}
      {count === undefined ? null : <span className={styles.count}>{count}</span>}
    </>
  )

  /*
   * ★V7: 行き先があるタブは、開いているものも含めてリンクのまま出す。
   * 現在地は aria-current="page" で示し、role="tab" は付けない。
   * （開いているタブを押せないボタンにしていた頃は、現在地が
   * 読み上げで伝わらず、見た目も薄くなっていた。）
   */
  if (href && !disabled) {
    return (
      <Link href={href} className={classes} aria-current={current ? 'page' : undefined}>
        {body}
      </Link>
    )
  }

  /*
   * ★V7: ボタン切り替えのタブは tab として、開いているかを
   * aria-selected で出す（読みやすさ優先で aria-current と言い分ける）。
   */
  return (
    <button
      type="button"
      className={classes}
      role="tab"
      aria-selected={current ?? false}
      aria-disabled={disabled || undefined}
      onClick={onClick}
      disabled={disabled || (current && !onClick)}
    >
      {body}
    </button>
  )
}
