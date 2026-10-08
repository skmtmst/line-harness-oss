'use client'

/*
 * ★V8 友だちの段の頭。
 * - FriendsTabs：タブの並び（x6QsVz の「タブの段」・下に細い線）
 * - FriendsSectionHead：管理の画面（重複検出・統合ユーザー・UID移行・CSV）の頭
 *   （ADjK8・hn6Y8・T9gblG・L48eY の「板の頭」：題／説明／タブ／タブの説明。戻るリンクは置かない）
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { FRIENDS_TABS, FRIENDS_TAB_NOTES, type FriendsTabKey } from './nav'
import styles from './head.module.css'

export function FriendsTabs({ current, line = true, action }: { current: FriendsTabKey; line?: boolean; action?: ReactNode }) {
  return (
    <div className={line ? `${styles.tabRow} ${styles.tabRowLine}` : styles.tabRow}>
      <nav className={styles.tabs} aria-label="友だちの画面">
        {FRIENDS_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={tab.key === current ? `${styles.tab} ${styles.tabCurrent}` : styles.tab}
            aria-current={tab.key === current ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {action ? <div className={styles.tabAction}>{action}</div> : null}
    </div>
  )
}

export function FriendsSectionHead({
  current,
  description,
  action,
  title = '友だち',
  note,
  tabs = true,
}: {
  current: FriendsTabKey
  description: ReactNode
  /** タブの行の右端（絵の「表示中をCSVで書き出す」など）。 */
  action?: ReactNode
  title?: ReactNode
  /** タブの下の1行。省くとタブごとの決まった文。null で出さない。 */
  note?: ReactNode | null
  tabs?: boolean
}) {
  const noteText = note === undefined ? FRIENDS_TAB_NOTES[current] : note
  return (
    <header className={styles.head} data-template-region="heading">
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{description}</p>
      {tabs ? <FriendsTabs current={current} line={false} action={action} /> : null}
      {noteText ? (
        <p className={styles.note}>
          <Info aria-hidden="true" className={styles.noteIcon} />
          <span>{noteText}</span>
        </p>
      ) : null}
    </header>
  )
}
