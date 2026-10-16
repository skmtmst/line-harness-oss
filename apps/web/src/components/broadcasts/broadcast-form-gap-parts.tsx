'use client'

import { LinePreviewFlex } from '@/components/shared/line-preview';
import { useRef, useState } from 'react';
import { api, type BroadcastBubble, type BroadcastBubbleType, type BroadcastMessageButton } from '@/lib/api';
import MediaSlot from '@/components/shared/media-slot';
import MediaPickerDialog from '@/components/shared/media-picker-dialog';
import styles from './broadcast-form-v8.module.css';
import BroadcastTextBubble from './broadcast-text-bubble';
import { type MessageKindState } from '@/components/scenarios/message-kind-fields';
import Button from '@/components/shared/button';
import { ComposerCarouselPreview } from '@/components/shared/message-composer';
import { SaveErrorField } from '@/components/shared/save-form-errors';



/*
 * 右側のプレビューの枠は、LINEのトーク画面に近い共通部品
 * `LinePreview`（`components/shared/line-preview`）を使う。
 * 画面ごとに枠の色を作らない（B-6）。
 */

/**
 * 種類の名前。**内部の語をそのまま画面へ出さない。**
 *
 * ここに無い種類が来たときに元の値へ落とすと、テンプレートの札に
 * `text` や `carousel` が出る（設計 `p97Tf` で見つかった）。
 * 知らない種類は「その他」にして、内部の語は出さない。
 */
const TYPE_LABELS: Record<BroadcastBubbleType, string> = {
  text: 'テキスト', sticker: 'スタンプ', image: '写真', flex: 'Flex', location: '位置情報',
  audio: '音声', carousel: 'カルーセル', video: '動画', rich_message: 'リッチメッセージ',
  rich_video: 'リッチビデオ', card_message: 'カードタイプ', coupon: 'クーポン', research: 'リサーチ',
}


/** 選んだ時点で止める文。上限と今の大きさを両方言う（例「動画は200MBまでです。今のファイルは350MBです」）。 */
export function mediaTooLargeMessage(isVideo: boolean, bytes: number): string {
  const mb = bytes / (1024 * 1024)
  const size = mb >= 10 ? `${Math.round(mb)}MB` : `${Math.round(mb * 10) / 10}MB`
  return isVideo ? `動画は200MBまでです。今のファイルは${size}です` : `画像は10MBまでです。今のファイルは${size}です`
}


/**
 * 画像・動画のアップロード欄。統括の一括配信（v8/hq-broadcasts）も同じ欄を使う。
 * lineAccountId を渡すと動画の置き場をそのアカウントにする（null＝どの店にも属さない。統括）。省けば今選んでいる店。
 */
export function MediaUpload({ bubble, onChange, lineAccountId, mediaAccountId = null }: { bubble: BroadcastBubble; onChange: (content: Record<string, unknown>) => void; lineAccountId?: string | null; /** 渡すと「登録メディアから選ぶ」を出す（そのアカウントの登録メディア）。 */ mediaAccountId?: string | null }) {
  const latest = useRef({ bubble, onChange })
  latest.current = { bubble, onChange }
  // 登録メディアから選ぶ先。統括（null）はどの店にも属さないので出さない。
  const pickFrom = mediaAccountId
  const [picking, setPicking] = useState<'main' | 'preview' | null>(null)
  const isVideo = bubble.type === 'video' || bubble.type === 'rich_video'
  const noun = isVideo ? '動画' : '画像'
  const scope = `${bubble.id}-${bubble.type}-${lineAccountId ?? ''}`
  const content = bubble.content
  const original = typeof content.originalContentUrl === 'string' ? content.originalContentUrl : ''
  const preview = typeof content.previewImageUrl === 'string' ? content.previewImageUrl : ''
  const sendFile = async (file: File) => {
    const res = await api.broadcastMessageAssets.upload(file, lineAccountId)
    if (!res.success) throw new Error(res.error)
    return res.data.url
  }
  const setMain = (url: string) => {
    const now = latest.current.bubble.content
    latest.current.onChange({ ...now, originalContentUrl: url, previewImageUrl: isVideo ? (now.previewImageUrl ?? '') : url })
  }
  const setPreview = (url: string) => latest.current.onChange({ ...latest.current.bubble.content, previewImageUrl: url })
  const main = (
    <SaveErrorField names={["original","main"]}><MediaSlot
      kind={isVideo ? 'video' : 'image'}
      title={`${noun}を追加`}
      value={original || null}
      accept={isVideo ? 'video/mp4' : 'image/jpeg,image/png'}
      limitText={isVideo ? '1ファイル200メガバイト以内・MP4' : '1ファイル10メガバイト以内・JPEG・PNG'}
      validate={(file) => {
        const allowed = isVideo ? ['video/mp4'] : ['image/jpeg', 'image/png']
        const max = isVideo ? 200 * 1024 * 1024 : 10 * 1024 * 1024
        if (!allowed.includes(file.type)) return isVideo ? 'MP4のみ対応しています' : 'JPEG・PNGのみ対応しています'
        if (file.size > max) return mediaTooLargeMessage(isVideo, file.size)
        return ''
      }}
      upload={sendFile}
      scope={scope}
      onChange={(url) => setMain(url ?? '')}
      onMediaPick={pickFrom ? () => setPicking('main') : undefined}
    /></SaveErrorField>
  )
  return <div className="space-y-3">
    {isVideo ? (
      <div className={styles.mediaRow}>
        {main}
        <SaveErrorField names={["preview"]}><MediaSlot
          size="compact"
          title="プレビュー画像を追加"
          previewAlt="動画のプレビュー画像"
          value={preview || null}
          accept="image/jpeg,image/png"
          maxBytes={1024 * 1024}
          upload={sendFile}
          scope={scope}
          onChange={(url) => setPreview(url ?? '')}
          onMediaPick={pickFrom ? () => setPicking('preview') : undefined}
          urlEntry={{ value: preview, onChange: setPreview, label: '動画のプレビュー画像のURL', placeholder: 'https://…（JPEG/PNG・1MBまで）' }}
        /></SaveErrorField>
      </div>
    ) : main}
    {isVideo ? <p className="text-xs text-ink-faint">プレビュー画像は LINE 側で必須です（https・JPEG/PNG・1MBまで）。</p> : null}
    {bubble.type === 'rich_video' && <SaveErrorField names={["actionUrl","content.actionUrl","action_url","content.action_url"]}><input value={String(content.actionUrl ?? '')} onChange={(e) => onChange({ ...content, actionUrl: e.target.value })} placeholder="再生終了後に開くURL" className="w-full rounded-control border border-hairline px-3 py-2 text-sm" /></SaveErrorField>}
    <MediaPickerDialog
      open={picking !== null}
      accountId={pickFrom}
      kind={picking === 'main' && isVideo ? 'video' : 'image'}
      onClose={() => setPicking(null)}
      onSelect={(item) => {
        if (picking === 'preview') setPreview(item.url)
        else setMain(item.url)
        setPicking(null)
      }}
    />
  </div>
}


/** LINE の見え方の吹き出し1つ。統括の一括配信（v8/hq-broadcasts）も使う。 */
export function BubblePreview({ bubble, buttons = [], accountName, composer = false }: { bubble: BroadcastBubble; buttons?: BroadcastMessageButton[]; accountName?: string; composer?: boolean }) {
  const text = String(bubble.content.text ?? '')
  const imageUrl = String(bubble.content.previewImageUrl ?? bubble.content.imageUrl ?? '')
  if (bubble.type === 'text') return <BroadcastTextBubble text={text} buttons={buttons} accountName={accountName} />
  if (bubble.type === 'sticker') {
    const st = (bubble.content.state as MessageKindState | undefined)?.sticker
    return st?.packageId && st?.stickerId
      ? <img src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${st.stickerId}/android/sticker.png`} alt="スタンプ" className="h-24 w-24 object-contain" />
      : <div className="bg-canvas-sunken text-ink-faint flex h-24 w-24 items-center justify-center rounded-card text-xs">スタンプ</div>
  }
  if (bubble.type === 'location') {
    const loc = (bubble.content.state as MessageKindState | undefined)?.location
    return <div className="bg-canvas w-[82%] rounded-card p-3 text-label shadow-card">
      <p className="text-ink font-bold">{loc?.title || '場所'}</p>
      <p className="text-ink-faint mt-0.5 text-micro">{loc?.address || '住所を入れると出ます'}</p>
    </div>
  }
  if (bubble.type === 'audio') {
    const au = (bubble.content.state as MessageKindState | undefined)?.audio
    return <div className="bg-canvas flex w-[82%] items-center gap-2 rounded-card p-3 text-label shadow-card">
      <span className="text-lg">▶</span>
      <span className="text-ink-faint text-micro">{au?.duration ? `${au.duration} 秒` : '音声'}</span>
    </div>
  }
  if (bubble.type === 'carousel') {
    if (composer) return <ComposerCarouselPreview bubble={bubble} />
    const name = String(bubble.content.templateName ?? '')
    return <div className="flex w-full gap-2 overflow-x-auto pb-1">
      {[0, 1].map((i) => <div key={i} className="bg-canvas w-36 shrink-0 rounded-card p-2 shadow-card">
        <div className="bg-canvas-sunken h-20 rounded-control" />
        <p className="text-ink mt-2 truncate text-xs font-medium">{i === 0 ? (name || 'カルーセル') : '…'}</p>
      </div>)}
    </div>
  }
  if (bubble.type === 'image') return imageUrl ? <img src={imageUrl} alt="写真プレビュー" className="max-h-52 w-[82%] rounded-card object-cover" /> : <div className="flex h-36 w-[82%] items-center justify-center rounded-card bg-canvas-sunken text-sm text-ink-faint">写真</div>
  if (bubble.type === 'flex') return <LinePreviewFlex content={typeof bubble.content.flexJson === 'string' ? bubble.content.flexJson : JSON.stringify(bubble.content)} />
  if (bubble.type === 'video' || bubble.type === 'rich_video') return <div className="relative flex h-40 w-[82%] items-center justify-center overflow-hidden rounded-card bg-ink text-canvas"><span className="text-4xl">▶</span><span className="absolute bottom-2 left-3 text-xs">{bubble.type === 'rich_video' ? 'リッチビデオ' : '動画'}</span></div>
  if (bubble.type === 'card_message') {
    const cards = Array.isArray(bubble.content.cards) ? bubble.content.cards as Array<Record<string, unknown>> : [{ title: bubble.content.assetName ?? 'カード' }]
    return <div className="flex w-full gap-2 overflow-x-auto pb-1">{cards.map((card, index) => <div key={index} className="w-36 shrink-0 rounded-card bg-canvas p-2 shadow-card">{card.imageUrl ? <img src={String(card.imageUrl)} alt="" className="h-20 w-full rounded-control object-cover" /> : <div className="h-20 rounded-control bg-canvas-sunken"/>}<p className="mt-2 truncate text-xs font-semibold">{String(card.title ?? 'カード')}</p><Button variant="primary" className="mt-2 w-full rounded-mini px-0 py-1 text-nano border-0 h-auto whitespace-normal">{String(card.actionLabel ?? '詳しく見る')}</Button></div>)}</div>
  }
  return <div className="w-[82%] overflow-hidden rounded-card bg-canvas shadow-card">{imageUrl && <img src={imageUrl} alt="素材プレビュー" className="h-32 w-full object-cover" />}<div className="p-3"><p className="text-xs font-medium">{String(bubble.content.assetName ?? TYPE_LABELS[bubble.type])}</p><p className="mt-1 text-micro text-ink-faint">{TYPE_LABELS[bubble.type]}のプレビュー</p></div></div>
}
export { TYPE_LABELS }
