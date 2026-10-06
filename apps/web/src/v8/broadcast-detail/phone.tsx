import { BatteryFull, ChevronDown, ChevronLeft, ImageIcon, Menu, Phone as PhoneIcon, Search, Signal, Wifi } from 'lucide-react'
import BroadcastMessagePreview from '@/components/broadcasts/broadcast-message-preview'
import type { BroadcastBubble, BroadcastMessageButton } from '@/lib/api'
import styles from './phone.module.css'

/**
 * ★V8 右の欄の「本物のスマホ」（絵 `cgiGB`・`pNiUk`・`F3X1Mo`・`cdZBf` の「スマホ 配信の中身」）。
 *
 * 外枠 330×690・黒い島・LINE の上の帯・トーク・下のメニュー。
 * テキストは絵の吹き出し（幅200）で出し、写真・カルーセルなどは
 * 今の見本の部品（BroadcastMessagePreview）をトークの中に置く。
 */
export default function BroadcastPhone({
  broadcast,
  accountName,
  chip,
  time,
}: {
  broadcast: {
    messageType: string
    messageContent: string
    messageBubbles?: BroadcastBubble[] | null
    messageOptions?: { buttons?: BroadcastMessageButton[] | null } | null
  }
  /** 部屋の名（LINE公式アカウントの表示名）。 */
  accountName: string
  /** トークの上の札。例「8/24（月）10:00 に届きます」「送る前の見本」。 */
  chip?: string
  /** 吹き出しの横の時刻。まだ決まっていなければ「—」。 */
  time: string
}) {
  const initial = accountName.trim().charAt(0) || '然'
  const single = !(broadcast.messageBubbles?.length)
  const plainText = broadcast.messageType === 'text' && single
  /* 写真1枚は絵の「画像」（200×200・角丸16）。URL が読めないときは枠と「写真」だけ。 */
  const photo = broadcast.messageType === 'image' && single ? { url: imageUrlOf(broadcast.messageContent) } : null
  return (
    <figure className={styles.phone} aria-label="届いたときの見え方の見本">
      <div className={styles.screen}>
        <div className={styles.statusBar}>
          <span className={styles.clock}>9:41</span>
          <span className={styles.island} aria-hidden="true" />
          <span className={styles.statusIcons} aria-hidden="true">
            <Signal size={15} strokeWidth={1.8} />
            <Wifi size={15} strokeWidth={1.8} />
            <BatteryFull size={20} strokeWidth={1.8} />
          </span>
        </div>
        <div className={styles.talkHead}>
          <ChevronLeft size={20} aria-hidden="true" />
          <span className={styles.talkName}>{accountName}</span>
          <Search size={17} aria-hidden="true" />
          <PhoneIcon size={17} aria-hidden="true" />
          <Menu size={17} aria-hidden="true" />
        </div>
        <div className={styles.talk}>
          {chip ? <p className={styles.dateRow}><span className={styles.dateChip}>{chip}</span></p> : null}
          <div className={styles.row}>
            <span className={styles.avatar} aria-hidden="true">{initial}</span>
            <div className={styles.sender}>
              <span className={styles.senderName}>{accountName}</span>
              <div className={styles.bodyRow}>
                {plainText ? (
                  <p className={styles.bubble}>{broadcast.messageContent}</p>
                ) : photo ? (
                  photo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- LINE に送る画像の見本（外部の URL）
                    <img className={styles.photo} src={photo.url} alt="送る写真" />
                  ) : (
                    <span className={`${styles.photo} ${styles.photoEmpty}`}>
                      <ImageIcon aria-hidden="true" />
                      写真
                    </span>
                  )
                ) : (
                  <div className={styles.rich}>
                    <BroadcastMessagePreview
                      bubbles={broadcast.messageBubbles}
                      messageType={broadcast.messageType}
                      messageContent={broadcast.messageContent}
                      buttons={broadcast.messageOptions?.buttons}
                    />
                  </div>
                )}
                <span className={styles.time}>{time}</span>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.menuBar}>
          <span>メニュー</span>
          <ChevronDown size={12} aria-hidden="true" />
        </div>
        <div className={styles.homeBar}><span className={styles.homeLine} aria-hidden="true" /></div>
      </div>
    </figure>
  )
}

/** 写真の中身（`{"originalContentUrl": …}`）から見本に出す URL を読む。読めなければ null。 */
function imageUrlOf(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { previewImageUrl?: unknown; originalContentUrl?: unknown }
    const url = typeof parsed.previewImageUrl === 'string' ? parsed.previewImageUrl : parsed.originalContentUrl
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null
  } catch {
    return null
  }
}
