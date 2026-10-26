import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './status-action.module.css'

/** 押せる状態の札。札（StatusBadge・StatusPill）の見た目はそのまま、押すと関係する画面を開く。画面の中で札をボタンで包まない。 */
export default function StatusAction({ children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> & { children: ReactNode }) {
  return <button type="button" className={styles.action} data-status-action="" {...props}>{children}</button>
}
