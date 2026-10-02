import type { ReactNode } from 'react'
import styles from './readonly-v8.module.css'

/** 通知の組の閲覧画面内で使う見出し。共通の枠やメニューは触らない。 */
export default function ReadonlyHeaderV8({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className={styles.header}><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className={styles.actions}>{actions}</div>}</header>
}
