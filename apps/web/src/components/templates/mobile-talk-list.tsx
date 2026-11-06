'use client'

import Avatar from '@/components/shared/avatar'
import { MobileCardLink, MobileCardList } from './mobile-frame'
import styles from './mobile-talk-list.module.css'

/*
 * 電話の画面の会話の一覧の型（トークの一覧と、対応の「返事を待っているトーク」で同じ形）。
 * カード 1 列。顔・名前・時刻・最後のメッセージ。未読は顔の赤い点と名前の太字（色だけに頼らない）。
 * 取得・並び・押した時の既読は画面が持つ。
 */

export type MobileTalkItem = {
  id: string
  name: string
  pictureUrl?: string | null
  /** 最後のメッセージの 1 行（画像・スタンプなどは言葉にした物）。 */
  preview: string
  /** こちらから送ったのが最後なら「返信：」を付ける。 */
  outgoing?: boolean
  /** 「17:51」「昨日」などの短い時刻と、その全文。 */
  time: string
  timeTitle?: string
  unread: boolean
  href: string
}

export function MobileTalkList({ label, items, onOpen }: { label: string; items: MobileTalkItem[]; onOpen?: (item: MobileTalkItem) => void }) {
  return (
    <MobileCardList label={label}>
      {items.map((item) => (
        <MobileCardLink key={item.id} href={item.href} onClick={onOpen ? () => onOpen(item) : undefined}>
          <span className={styles.row} data-unread={item.unread || undefined}>
            <span className={styles.face}>
              <Avatar name={item.name} src={item.pictureUrl} size={40} />
              {item.unread ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
            </span>
            <span className={styles.body}>
              <span className={styles.head}>
                <span className={styles.name} title={item.name}>{item.name}</span>
                <time className={styles.time} title={item.timeTitle || undefined}>{item.time}</time>
              </span>
              <span className={styles.preview} title={item.preview || undefined}>
                {item.unread ? <span className="sr-only">未読。</span> : null}
                {item.outgoing ? <span className={styles.outgoing}>返信：</span> : null}
                {item.preview || 'まだメッセージはありません'}
              </span>
            </span>
          </span>
        </MobileCardLink>
      ))}
    </MobileCardList>
  )
}
