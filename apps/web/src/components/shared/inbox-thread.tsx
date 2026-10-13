import type { ReactNode } from 'react'
import { Bot } from 'lucide-react'
import styles from './inbox-thread.module.css'

export function InboxMessageDay({ first, children }: { first: boolean; children: ReactNode }) {
  return <div className={styles.day} data-first={first || undefined}>{children}</div>
}
export function InboxQuotedMessage({ children }: { children: ReactNode }) {
  return <div data-inbox-v6="quoted-message" className={styles.quoted}>{children}</div>
}
/** 媒体の取得・検索・引用の動きは画面が渡し、左右の会話の形は共通で持つ。 */
export function InboxMessage({ outgoing, last, time, onQuote, searchHit, senderName, autoLabel, children }: {
  outgoing: boolean; last: boolean; time: string; onQuote?: () => void
  searchHit?: string | null; senderName?: string | null; autoLabel?: string | null; children: ReactNode
}) {
  const meta = <span className={styles.meta}><time>{time}</time>{onQuote ? <button type="button" data-inbox-v6="quote-reply" className={styles.quoteBtn} onClick={onQuote}>引用</button> : null}</span>
  const bubble = <div className={outgoing ? styles.bubbleOut : styles.bubbleIn} data-search-hit={searchHit ?? undefined}>{children}</div>
  return <div className={outgoing ? styles.rowOut : styles.rowIn} data-last={last || undefined}>
    {outgoing ? <div className={styles.outCol}><div className={styles.outLine}>{meta}{bubble}</div>
      {senderName ? <span className={styles.sender} title={senderName}><span aria-hidden="true" className={styles.senderFace}>{senderName.charAt(0)}</span>{senderName} が送信</span>
        : <span className={styles.sender}><span aria-hidden="true" className={styles.senderBot}><Bot aria-hidden="true" /></span>{autoLabel ? `自動：${autoLabel}` : '自動で送信'}</span>}
    </div> : <>{bubble}{meta}</>}
  </div>
}
