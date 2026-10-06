'use client'

/*
 * まだ中身が無いタブの見せ方（Q5F2QE の 6.・oLls9）。6つのタブで共通。
 * 説明で行き止まりにせず、この友だちを引き継ぐ操作か関連する一覧への行き先を添える（FRIEND-27）。
 */
import type { ReactNode } from 'react'
import Button from '@/components/shared/button'
import styles from './detail.module.css'

export type EmptyTabAction =
  | { label: string; href: string; primary?: boolean }
  | { label: string; onClick: () => void; primary?: boolean }

export default function EmptyTab({ icon, title, text, actions }: { icon: ReactNode; title: string; text: string; actions: EmptyTabAction[] }) {
  return (
    <div className={styles.pane}>
      <div className={styles.empty}>
        <span className={styles.emptyIcon} aria-hidden>{icon}</span>
        <p className={styles.emptyTitle}>{title}</p>
        <p className={styles.emptyText}>{text}</p>
        {actions.length ? (
          <div className={styles.emptyActions}>
            {actions.map((a) => ('href' in a
              ? <Button key={a.label} href={a.href} variant={a.primary ? 'primary' : undefined}>{a.label}</Button>
              : <Button key={a.label} onClick={a.onClick} variant={a.primary ? 'primary' : undefined}>{a.label}</Button>))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
