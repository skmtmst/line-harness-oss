'use client'

import { type MessageKindState } from '@/components/scenarios/message-kind-fields'
import Button from '@/components/shared/button'
import { LinePreviewFlex } from '@/components/shared/line-preview'
import { ComposerCarouselPreview } from '@/components/shared/message-composer'
import { type BroadcastBubble,type BroadcastMessageButton } from '@/lib/api'
import { TYPE_LABELS } from './broadcast-form-model'
import BroadcastTextBubble from './broadcast-text-bubble'


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
