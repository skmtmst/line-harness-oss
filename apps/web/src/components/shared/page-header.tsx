import type { ReactNode } from 'react'
import Breadcrumb, { type Crumb } from './breadcrumb'
import styles from './page-header.module.css'

/**
 * ページヘッダー。★V5 227枚すべての先頭にある帯。
 *
 * パンくず・題・一行の説明・右の操作。この4つで1つ。
 *
 * `actions` の**最後には必ず「マニュアル」を置く**。画面ごとに位置が
 * 変わると、探す場所が毎回変わる。
 */
export default function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
  className,
}: {
  breadcrumb: Crumb[]
  title: string
  /** 「この画面で何ができるか」を一行で。無い画面を作らない。 */
  description: string
  /** 右に並べる操作。最後は「マニュアル」。 */
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={[styles.header, className].filter(Boolean).join(' ')}>
      <div className={styles.heading}>
        <Breadcrumb items={breadcrumb} />
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
