import type { ButtonHTMLAttributes, ReactNode } from 'react'
import Button from './button'
import type { HTMLAttributes } from 'react'
import styles from './inbox-list.module.css'

type PartProps = HTMLAttributes<HTMLDivElement>
/** 絞り込みの動きは画面が渡し、受信箱の列の並びはここが持つ。 */
export function InboxListHeader(props: HTMLAttributes<HTMLElement>) { return <section {...props} className={styles.header} /> }
export function InboxListHeadline(props: PartProps) { return <div {...props} className={styles.headline} /> }
export function InboxListSearch(props: PartProps) { return <div {...props} className={styles.search} /> }
export function InboxFilterControls(props: PartProps) { return <div {...props} className={styles.filters} /> }

/** 会話・メール・古い本文の取得は画面が持ち、続きを読む操作の形は共通で持つ。 */
export function InboxHistoryButton({ context, busy, onClick, children }: { context: 'list' | 'thread'; busy: boolean; onClick: () => void; children: ReactNode }) {
  return <Button variant="text" type="button" busy={busy} busyLabel="読み込み中..." disabled={busy} onClick={onClick} className={context === 'list' ? styles.loadMore : styles.olderMessages}>{children}</Button>
}

/** 会話を開いている印は、マウスを乗せた印とは分ける。 */
export function InboxListRow({ selected, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return <button {...props} type="button" aria-current={selected ? 'true' : undefined} className={[styles.row, props.className].filter(Boolean).join(' ')} />
}
