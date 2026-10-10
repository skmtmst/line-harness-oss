import { ImageIcon } from 'lucide-react'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
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
  const plainText = broadcast.messageType === 'text' && single && !broadcast.messageOptions?.buttons?.length
  /* 写真1枚は絵の「画像」（200×200・角丸16）。URL が読めないときは枠と「写真」だけ。 */
  const photo = broadcast.messageType === 'image' && single ? { url: imageUrlOf(broadcast.messageContent) } : null
  return (
    <LinePreview title={null} accountName={accountName} caption={chip}>
      <LinePreviewMessage accountName={accountName} avatar={initial} time={time}>
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
      </LinePreviewMessage>
    </LinePreview>
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
