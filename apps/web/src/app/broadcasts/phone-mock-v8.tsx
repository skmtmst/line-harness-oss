import { BatteryFull, ChevronDown, ChevronLeft, Menu, Phone, Search, Signal, Wifi } from 'lucide-react'
import BroadcastMessagePreview from '@/components/broadcasts/broadcast-message-preview'
import type { BroadcastBubble, BroadcastMessageButton } from '@/lib/api'
import styles from './phone-mock-v8.module.css'

/**
 * ★V8 右の欄の「本物のスマホ」（夕15・絵 `F3X1Mo` / `cgiGB` / `cdZBf`）。
 *
 * LINE のトーク画面に近い形で、届く見本を出す。枠・時計の帯・部屋名・
 * 下のメニューはここで持ち、吹き出しの中身は BroadcastMessagePreview。
 * 下書きでは「送る前の見本」、予約では「届く日時」の札を吹き出しの上に置く。
 */
export default function BroadcastPhoneMock({
  broadcast,
  accountName,
  chip,
}: {
  broadcast: {
    messageType: string
    messageContent: string
    messageBubbles?: BroadcastBubble[] | null
    messageOptions?: { buttons?: BroadcastMessageButton[] | null } | null
  }
  /** 部屋の名（LINE公式アカウントの表示名）。 */
  accountName: string
  /** 吹き出しの上の札。例「8/24（月）10:00 に届きます」「送る前の見本」。 */
  chip?: string
}) {
  const senderInitial = accountName.trim().charAt(0) || '然'
  return (
    <div className={styles.phone} aria-label="届いたときの見え方の見本">
      <div className={styles.screen}>
        <div className={styles.statusBar}>
          <span>9:41</span>
          <span className={styles.island} aria-hidden="true" />
          <span className={styles.statusIcons} aria-hidden="true">
            <Signal size={13} />
            <Wifi size={13} />
            <BatteryFull size={15} />
          </span>
        </div>
        <div className={styles.chatHeader}>
          <ChevronLeft size={18} aria-hidden="true" />
          <span className={styles.chatName}>{accountName}</span>
          <span className={styles.chatHeaderIcons} aria-hidden="true">
            <Search size={15} />
            <Phone size={15} />
            <Menu size={15} />
          </span>
        </div>
        <div className={styles.chatBody}>
          {chip ? <span className={styles.dateChip}>{chip}</span> : null}
          <div className={styles.sender}>
            <span className={styles.senderAvatar} aria-hidden="true">{senderInitial}</span>
            <span className={styles.senderName}>{accountName}</span>
          </div>
          <div className={styles.bubbles}>
            <BroadcastMessagePreview
              bubbles={broadcast.messageBubbles}
              messageType={broadcast.messageType}
              messageContent={broadcast.messageContent}
              buttons={broadcast.messageOptions?.buttons}
            />
          </div>
        </div>
        <div className={styles.chatFooter}>
          <span>メニュー <ChevronDown size={10} style={{ display: 'inline', verticalAlign: '-1px' }} aria-hidden="true" /></span>
          <span className={styles.homeIndicator} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
