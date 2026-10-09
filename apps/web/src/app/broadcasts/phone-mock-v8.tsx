import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
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
    <LinePreview title={null} accountName={accountName} caption={chip}>
      <LinePreviewMessage accountName={accountName} avatar={senderInitial} time="">
            <BroadcastMessagePreview
              bubbles={broadcast.messageBubbles}
              messageType={broadcast.messageType}
              messageContent={broadcast.messageContent}
              buttons={broadcast.messageOptions?.buttons}
            />
      </LinePreviewMessage>
    </LinePreview>
  )
}
