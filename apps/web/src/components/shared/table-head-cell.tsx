'use client'

import type { ReactNode, ThHTMLAttributes } from 'react'
import TruncatedText from './truncated-text'
import HelpTip from './help-tip'
import styles from './table.module.css'

type Scope = NonNullable<ThHTMLAttributes<HTMLTableCellElement>['scope']>

export type ThProps = Omit<
  ThHTMLAttributes<HTMLTableCellElement>,
  'align' | 'children' | 'className' | 'scope'
> & {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
  scope?: Scope
  /** 短い列では1行で省略し、titleで全文を読める。 */
  truncate?: boolean
  /** 読むための履歴など、操作列の題も見せる表で指定する。既定は読み上げのみ。 */
  showActionLabel?: boolean
  /** 白い板が狭いときだけ、補助列を畳む。見出しと本文で揃える。 */
  collapseAt?: 'narrow'
  /** 列の余った幅をこのセルに割り当てる。 */
  grow?: boolean
  /** 文字の先頭を名前のフォルダ印に揃える。 */
  inset?: string
  /**
   * 定義・分母・単位・言葉の意味。見出しのすぐ右の「？」へ入れる
   * （★V7・§2-1b）。表の下の注はここへ移し、2回書かない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は見出し文字。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
}

/** Pencil V5/V6の `tPTMp` を正本にした表見出しセル。 */
export function Th({
  children,
  align = 'left',
  className,
  scope = 'col',
  help,
  helpLabel,
  helpHref,
  truncate,
  showActionLabel = false,
  collapseAt,
  grow,
  inset,
  ...cellProps
}: ThProps) {
  const classes = [
    styles.cell,
    align === 'right' && styles.right,
    align === 'center' && styles.center,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const hasHelp = help !== undefined && help !== null
  const actionHeading = children === '操作' && !showActionLabel
  const heading = helpLabel ?? (typeof children === 'string' ? children : 'この項目')

  return (
    <th className={classes} data-align={align} scope={scope} data-cell-collapse={collapseAt} data-cell-grow={grow || undefined} data-cell-align={align} style={inset ? { paddingInlineStart: inset } : undefined} {...cellProps}>
      {actionHeading ? <span className="sr-only">操作</span> : truncate ? typeof children === 'string' ? <TruncatedText className={styles.truncated} value={children} /> : <span className={styles.truncated}>{children}</span> : children}
      {hasHelp ? (
        <HelpTip label={`${heading}の説明`}>
          {help}
          {helpHref ? <a href={helpHref}>くわしく</a> : null}
        </HelpTip>
      ) : null}
    </th>
  )
}
