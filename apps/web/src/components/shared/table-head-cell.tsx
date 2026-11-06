'use client'

import type { ReactNode, ThHTMLAttributes } from 'react'

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
  columnKind?: 'check' | 'name' | 'menu'
  grow?: boolean
  /** 余った幅の割合（grow の列どうしの比。省略は従来どおり）。見出しと本文に同じ値を渡す。 */
  weight?: number
  /** 文字の先頭を名前のフォルダ印に揃える。 */
  inset?: string
  /**
   * 定義・分母・単位・言葉の意味。見出しのすぐ右の「？」へ入れる
   * （★管理画面・§2-1b）。表の下の注はここへ移し、2回書かない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は見出し文字。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
}
