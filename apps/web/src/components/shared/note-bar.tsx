import type { ReactNode } from 'react'
import Notice, { type NoticeTone } from './notice'

export type NoteTone = 'info' | 'success' | 'warn' | 'danger'

/**
 * 案内帯。「この画面は何をするところか」を一行で言う。
 *
 * **1画面に1本だけ。** 注意が要るときは `tone` を変えて差し替える。
 * 2本並べない。
 *
 * 一覧型・ボード型には必ず1本置く。作成型・詳細型には置かない
 * （右カラムの「つながる先」「気をつけること」が説明を担うため）。
 *
 * @deprecated 新しく書くときは `Notice`（`./notice`）を使う。
 * 4つの種類・左のアイコン・右の操作1つ・「？」の入れ口は同じ。
 * ここは互換のためだけに残し、中身は `Notice` が持つ。
 */
export default function NoteBar({
  tone = 'info',
  action,
  className,
  help,
  helpLabel,
  helpHref,
  children,
}: {
  tone?: NoteTone
  /** 帯の右に置く操作。 */
  action?: ReactNode
  className?: string
  /**
   * 読まなくても操作できる定義だけの補足。帯の文のすぐ右の「？」へ入れる
   * （★V7・§2-1b）。帯自体は残す。警告・失敗・操作の結果は入れない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は「この案内」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
  children: ReactNode
}) {
  return (
    <Notice
      tone={tone as NoticeTone}
      action={action}
      className={className}
      help={help}
      helpLabel={helpLabel}
      helpHref={helpHref}
    >
      {children}
    </Notice>
  )
}
