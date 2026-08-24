import type { ReactNode } from 'react'
import styles from './header.module.css'

export interface HeaderProps {
  title: string
  description?: string
  titleAction?: ReactNode
  action?: ReactNode
}

export default function Header({ title, description, titleAction, action }: HeaderProps) {
  return (
    <header className={styles.root} data-design-node="RWNQP" data-design-part="page-header">
      <div className={styles.content}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {titleAction}
        </div>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  )
}
