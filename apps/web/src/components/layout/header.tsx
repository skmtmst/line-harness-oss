import type { ReactNode } from 'react'
import styles from './header.module.css'

export interface HeaderProps {
  /**
   * 本文に出す画面名。**省くと `<h1>` を描かない。**
   *
   * 設計（Pencil）の本文に画面名テキストは無く、上部バー `cBSCb` が
   * 1つだけ持つ。本文にも出すと同じ名前が2回出て、運用者は
   * 「どちらが今いる画面か」が分からなくなる。
   * 名前は `usePageTitle` で上部バーへ渡し、ここでは説明と操作だけ描く。
   */
  title?: string
  description?: string
  titleAction?: ReactNode
  action?: ReactNode
}

export default function Header({ title, description, titleAction, action }: HeaderProps) {
  return (
    <header className={styles.root} data-design-node="RWNQP" data-design-part="page-header">
      <div className={styles.content}>
        {title || titleAction ? (
          <div className={styles.titleRow}>
            {title ? <h1 className={styles.title}>{title}</h1> : null}
            {titleAction}
          </div>
        ) : null}
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  )
}
