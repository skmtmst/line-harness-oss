'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { defaultTitleForPath } from '../shell/app-top-bar'
import { usePageChrome } from '../shell/page-chrome'
import Breadcrumb, { type Crumb } from '../shared/breadcrumb'
import styles from '../shared/page-header.module.css'

/**
 * `shared/page-header.tsx` の h2 版。
 *
 * 画面の `<h1>` は共通トップバー（`shared/top-bar.tsx`）が1つだけ持つ。
 * `PageHeader` は本文にも `<h1>` を置くため、使うと1画面に h1 が2つ
 * 並んでしまう（Issue #637、監査 D-3「h1重複」）。`components/shared/` は
 * 別担当の所有でこちらからは直せないので、同じ見た目・同じ出し分けで
 * 題だけ `<h2>` に落とした版をここに置く。
 *
 * 使い方・見た目は `PageHeader` と同じ。トップバーと同じ言葉のときは
 * 題を `sr-only` で目から外し、違うときは出す。読み上げの見出し順も
 * h1（トップバー）→ h2（本文の題）と階層が保たれる。
 */
export default function PageHeaderH2({
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
        <h2 className={shown ? styles.title : 'sr-only'}>{title}</h2>
        <p className={styles.description}>{description}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
