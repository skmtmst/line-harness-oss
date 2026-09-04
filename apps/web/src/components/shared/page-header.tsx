'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { defaultTitleForPath } from '../shell/app-top-bar'
import { usePageChrome } from '../shell/page-chrome'
import Breadcrumb, { type Crumb } from './breadcrumb'
import styles from './page-header.module.css'

/**
 * ページヘッダー。★V5 227枚すべての先頭にある帯。
 *
 * パンくず・題・一行の説明・右の操作。この4つで1つ。
 *
 * `actions` の**最後には必ず「マニュアル」を置く**。画面ごとに位置が
 * 変わると、探す場所が毎回変わる。
 *
 * ## トップバーと同じ言葉なら、本文では出さない
 *
 * **一律に隠すのではない。設計は画面の種類で分けている。**
 *
 * 一覧（`TC1b1` シナリオ配信）——トップバーが「シナリオ配信」を出し、
 * **本文に題は無い**。本文は注意帯から始まる。
 *
 * 詳細（`bV5Vs` シナリオ編集）——トップバーが**その記録の名前**
 * 「新規登録7日間フォロー」を出し、本文はパンくず「シナリオ配信」の下に
 * 同じ名前をもう一度出す。**ここは設計そのものが2回出している。**
 *
 * つまり重なるのは「トップバーと本文が同じ言葉のとき」だけ。
 * ここではトップバーが何を出しているかを見て、**同じときだけ隠す**。
 * 一律に隠すと、トップバーが区分名しか出さない下位画面
 * （`/friends/identity-candidates` はトップバーが「友だち」）で
 * **「重複候補の確認」がどこにも出なくなる。**
 *
 * **`<h1>` そのものは消さない。** 消すと、読み上げで「この画面は何か」を
 * 辿れなくなり、見出しの階層も h2 から始まってしまう。`sr-only` で
 * 目からだけ外す。
 */
export default function PageHeader({
  breadcrumb,
  title,
  description,
  titleDisplay = 'auto',
  actions,
  className,
}: {
  breadcrumb: Crumb[]
  title: string
  /** 「この画面で何ができるか」を一行で。無い画面を作らない。 */
  description: string
  /**
   * 題の出し方を固定する。
   *
   * 既定（省略）は**トップバーを見て決める**——同じ言葉なら隠し、
   * 違うなら出す。トップバーの外に置く画面だけ `'always'` を渡す。
   */
  titleDisplay?: 'auto' | 'always'
  /** 右に並べる操作。最後は「マニュアル」。 */
  actions?: ReactNode
  className?: string
}) {
  const pathname = usePathname() ?? ''
  const { title: chromeTitle } = usePageChrome()
  const barTitle = chromeTitle ?? defaultTitleForPath(pathname)
  const shown = titleDisplay === 'always' || barTitle !== title

  return (
    <div className={[styles.header, className].filter(Boolean).join(' ')}>
      <div className={styles.heading}>
        <Breadcrumb items={breadcrumb} />
        <h1 className={shown ? styles.title : 'sr-only'}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
