'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import {
  api,
  type ApiBroadcast,
  type BroadcastBubble,
  type BroadcastBubbleType,
  type BroadcastMessageAsset,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import StickyBar from '@/components/shared/sticky-bar'
import {
  MAX_BUBBLES,
  MAX_TEXT_LENGTH,
  messageLengthLabel,
  messageLengthNotice,
} from './message-limits'
import {
  bubbleLegacyMessage,
  bubblesForSave,
  contentTemplateToBubble,
  isContentTemplateType,
  messageTemplateToBubble,
  type BroadcastTemplateOption,
} from '@/lib/broadcast-template'
import {
  TARGET_MODES,
  audienceError,
  buildAudienceCondition,
  type TargetMode,
} from '@/lib/broadcast-audience'
import type { SegmentCondition } from '@/lib/segment-condition'
import { newBroadcastDraftSession, persistBroadcastDraft } from '@/lib/broadcast-draft'
import ConditionBuilder from '@/components/shared/condition-builder'
import SegmentPresetControls from '@/components/broadcasts/segment-preset-controls'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import MessageKindFields, {
  emptyMessageKindState,
  serializeMessageKind,
  type MessageKind,
  type MessageKindState,
} from '@/components/scenarios/message-kind-fields'
import CarouselPicker from '@/components/scenarios/carousel-picker'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import BroadcastStepRail from '@/components/broadcasts/broadcast-step-rail'
import { broadcastSteps } from '@/components/broadcasts/broadcast-steps'

interface BroadcastFormProps {
  tags: Tag[]
  /** 作成された実物。予約だけを完了画面へ送り、下書きと取り違えない。 */
  onSuccess: (broadcast: ApiBroadcast) => void
  onCancel: () => void
  openTemplatePickerInitially?: boolean
  initialTemplateId?: string | null
  initialContentTemplateId?: string | null
  initialCondition?: SegmentCondition | null
}

/*
 * 右側のプレビューの枠は、**LINEのトーク画面を描いたもの**。
 * アプリのデザインの色ではないので、トークンにしない。
 * `bg-canvas` などに置き換えると、LINEに見えなくなって用をなさなくなる。
 */
const LINE_MOCK = {
  frame: 'border-[#1f2937]',   // 端末の外枠
  bar: 'bg-[#1f2937]',         // 上のバー
  wallpaper: 'bg-[#8faed2]',   // LINEの既定の壁紙
  onDark: 'text-white',        // 上のバーと日付の文字
} as const

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

/** 知らない種類でも内部の語を出さない。 */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type as BroadcastBubbleType] ?? 'その他'
}

/*
 * まだ送れない種別と、その理由。
 *
 * ここに無い種別は、シナリオと同じ組み立て（`line-message.ts`）を通って
 * そのまま LINE へ渡る。ここに載っているものは `bubbleLegacyMessage` が
 * 「テキストに JSON を入れたもの」に落とすので、**中身の JSON がそのまま
 * 相手のトークに届く**。送って初めて分かる壊れ方なので、選ばせない。
 *
 * リッチメッセージ・カードタイプ・クーポン・リサーチは、こちらで作った
 * 独自の型で、LINE に対応する種別が無い。Flex かカルーセルへ組み立て直す
 * 必要があるので、まだ蓋をしてある。
 */
const UNSENDABLE_TYPES: Partial<Record<BroadcastBubbleType, string>> = {
  rich_message: 'リッチメッセージは準備中です。いまは写真かFlexで作れます',
  rich_video: 'リッチビデオは準備中です。いまは動画で送れます',
  card_message: 'カードタイプは準備中です。いまはカルーセルで作れます',
  coupon: 'クーポンは準備中です',
  research: 'リサーチは準備中です',
}
const EMOJIS = ['😊', '✨', '🎉', '🐕', '🐈', '🌿', '❤️', '👍']

/**
 * 配信名の上限。設計 `zZ9fA` の「14 / 60文字」。
 *
 * 保存の口には上限が無いので、ここで止めなければいくらでも入る。
 * 一覧（`q76C35`）の1列目に出る名前なので、長いと表がその1件で崩れる。
 */
const TITLE_MAX = 60

/** 位置情報・音声・スタンプは、シナリオと同じ入力欄をそのまま使う。 */
const KIND_FIELD_TYPES = new Set<BroadcastBubbleType>(['location', 'audio', 'sticker'])

function emptyBubble(type: BroadcastBubbleType = 'text'): BroadcastBubble {
  const content: Record<string, unknown> = type === 'text' ? { text: '' }
    : type === 'image' ? { originalContentUrl: '', previewImageUrl: '' }
    : type === 'flex' ? { flexJson: '' }
    : type === 'video' ? { originalContentUrl: '', previewImageUrl: '' }
    : type === 'carousel' ? { templateId: '', templateName: '', columnsJson: '' }
    : KIND_FIELD_TYPES.has(type) ? { state: emptyMessageKindState() }
    : type === 'rich_video' ? { originalContentUrl: '', previewImageUrl: '', actionUrl: '' }
    : { assetId: '', assetName: '' }
  return { id: crypto.randomUUID(), type, content }
}

function MediaUpload({ bubble, onChange }: { bubble: BroadcastBubble; onChange: (content: Record<string, unknown>) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isVideo = bubble.type === 'video' || bubble.type === 'rich_video'
  const upload = async (file: File) => {
    const allowed = isVideo ? ['video/mp4'] : ['image/jpeg', 'image/png']
    const max = isVideo ? 200 * 1024 * 1024 : 10 * 1024 * 1024
    if (!allowed.includes(file.type)) { setError(isVideo ? 'MP4のみ対応しています' : 'JPEG・PNGのみ対応しています'); return }
    if (file.size > max) { setError(isVideo ? '200MB以下にしてください' : '10MB以下にしてください'); return }
    setBusy(true); setError('')
    try {
      const res = await api.broadcastMessageAssets.upload(file)
      if (!res.success) { setError(res.error); return }
      onChange({ ...bubble.content, originalContentUrl: res.data.url, previewImageUrl: isVideo ? (bubble.content.previewImageUrl ?? '') : res.data.url })
    } catch { setError('アップロードに失敗しました') } finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-hairline bg-canvas-sunken text-sm text-ink-faint hover:border-accent">
      <span className="font-semibold text-ink">{busy ? 'アップロード中…' : `${isVideo ? 'MP4動画' : 'JPEG / PNG画像'}を選択`}</span>
      <span className="mt-1 text-xs">上限 {isVideo ? '200MB' : '10MB'}</span>
      <input type="file" className="hidden" disabled={busy} accept={isVideo ? 'video/mp4' : 'image/jpeg,image/png'} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
    </label>
    {typeof bubble.content.originalContentUrl === 'string' && bubble.content.originalContentUrl && <p className="truncate text-xs text-accent">アップロード済み：{bubble.content.originalContentUrl}</p>}
    {isVideo && <input value={String(bubble.content.previewImageUrl ?? '')} onChange={(e) => onChange({ ...bubble.content, previewImageUrl: e.target.value })} placeholder="プレビュー画像URL（任意）" className="w-full rounded-control border border-hairline px-3 py-2 text-sm" />}
    {bubble.type === 'rich_video' && <input value={String(bubble.content.actionUrl ?? '')} onChange={(e) => onChange({ ...bubble.content, actionUrl: e.target.value })} placeholder="再生終了後に開くURL" className="w-full rounded-control border border-hairline px-3 py-2 text-sm" />}
    {error && <p className="text-xs text-danger">{error}</p>}
  </div>
}

function BubblePreview({ bubble }: { bubble: BroadcastBubble }) {
  const text = String(bubble.content.text ?? '')
  const imageUrl = String(bubble.content.previewImageUrl ?? bubble.content.imageUrl ?? '')
  if (bubble.type === 'text') return <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-card rounded-tl-sm bg-canvas px-3 py-2 text-[13px] shadow-sm">{text || 'テキストを入力すると表示されます'}</div>
  if (bubble.type === 'sticker') {
    const st = (bubble.content.state as MessageKindState | undefined)?.sticker
    return st?.packageId && st?.stickerId
      ? <img src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${st.stickerId}/android/sticker.png`} alt="スタンプ" className="h-24 w-24 object-contain" />
      : <div className="bg-canvas-sunken text-ink-faint flex h-24 w-24 items-center justify-center rounded-card text-xs">スタンプ</div>
  }
  if (bubble.type === 'location') {
    const loc = (bubble.content.state as MessageKindState | undefined)?.location
    return <div className="bg-canvas w-[82%] rounded-card p-3 text-[13px] shadow-sm">
      <p className="text-ink font-bold">{loc?.title || '場所'}</p>
      <p className="text-ink-faint mt-0.5 text-[11px]">{loc?.address || '住所を入れると出ます'}</p>
    </div>
  }
  if (bubble.type === 'audio') {
    const au = (bubble.content.state as MessageKindState | undefined)?.audio
    return <div className="bg-canvas flex w-[82%] items-center gap-2 rounded-card p-3 text-[13px] shadow-sm">
      <span className="text-lg">▶</span>
      <span className="text-ink-faint text-[11px]">{au?.duration ? `${au.duration} 秒` : '音声'}</span>
    </div>
  }
  if (bubble.type === 'carousel') {
    const name = String(bubble.content.templateName ?? '')
    return <div className="flex w-full gap-2 overflow-x-auto pb-1">
      {[0, 1].map((i) => <div key={i} className="bg-canvas w-36 shrink-0 rounded-card p-2 shadow">
        <div className="bg-canvas-sunken h-20 rounded-control" />
        <p className="text-ink mt-2 truncate text-xs font-bold">{i === 0 ? (name || 'カルーセル') : '…'}</p>
      </div>)}
    </div>
  }
  if (bubble.type === 'image') return imageUrl ? <img src={imageUrl} alt="写真プレビュー" className="max-h-52 w-[82%] rounded-card object-cover" /> : <div className="flex h-36 w-[82%] items-center justify-center rounded-card bg-canvas-sunken text-sm text-ink-faint">写真</div>
  if (bubble.type === 'flex') return <div className="w-[82%] rounded-card bg-canvas p-4 shadow-sm"><p className="text-xs font-bold text-info">Flexテンプレート</p><p className="mt-1 truncate text-[11px] text-ink-faint">{String(bubble.content.templateName ?? 'Flex JSON')}</p></div>
  if (bubble.type === 'video' || bubble.type === 'rich_video') return <div className="relative flex h-40 w-[82%] items-center justify-center overflow-hidden rounded-card bg-ink text-canvas"><span className="text-4xl">▶</span><span className="absolute bottom-2 left-3 text-xs">{bubble.type === 'rich_video' ? 'リッチビデオ' : '動画'}</span></div>
  if (bubble.type === 'card_message') {
    const cards = Array.isArray(bubble.content.cards) ? bubble.content.cards as Array<Record<string, unknown>> : [{ title: bubble.content.assetName ?? 'カード' }]
    return <div className="flex w-full gap-2 overflow-x-auto pb-1">{cards.map((card, index) => <div key={index} className="w-36 shrink-0 rounded-card bg-canvas p-2 shadow">{card.imageUrl ? <img src={String(card.imageUrl)} alt="" className="h-20 w-full rounded-control object-cover" /> : <div className="h-20 rounded-control bg-canvas-sunken"/>}<p className="mt-2 truncate text-xs font-bold">{String(card.title ?? 'カード')}</p><button className="mt-2 w-full rounded bg-accent-deep py-1 text-[10px] text-on-accent">{String(card.actionLabel ?? '詳しく見る')}</button></div>)}</div>
  }
  return <div className="w-[82%] overflow-hidden rounded-card bg-canvas shadow-sm">{imageUrl && <img src={imageUrl} alt="素材プレビュー" className="h-32 w-full object-cover" />}<div className="p-3"><p className="text-xs font-bold">{String(bubble.content.assetName ?? TYPE_LABELS[bubble.type])}</p><p className="mt-1 text-[11px] text-ink-faint">{TYPE_LABELS[bubble.type]}のプレビュー</p></div></div>
}

function BubbleEditor({ bubble, index, total, assets, onChange, onMove, onDelete }: {
  bubble: BroadcastBubble; index: number; total: number; assets: BroadcastMessageAsset[];
  onChange: (bubble: BroadcastBubble) => void; onMove: (direction: -1 | 1) => void; onDelete: () => void
}) {
  const availableAssets = assets.filter((asset) => asset.kind === bubble.type)
  // 差し込みをカーソルの位置に入れるために、入力欄そのものを渡す。
  const textRef = useRef<HTMLTextAreaElement>(null)
  return <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
    <div className="flex items-center gap-3 border-b border-hairline bg-canvas-sunken px-4 py-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-deep text-xs font-bold text-on-accent">{index + 1}</span>
      <select value={bubble.type} onChange={(e) => onChange(emptyBubble(e.target.value as BroadcastBubbleType))} className="min-w-0 flex-1 rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-semibold">
        {Object.entries(TYPE_LABELS).map(([value, label]) => {
          const reason = UNSENDABLE_TYPES[value as BroadcastBubbleType]
          return (
            <option key={value} value={value} disabled={Boolean(reason)}>
              {reason ? `${label}（準備中）` : label}
            </option>
          )
        })}
      </select>
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="h-9 w-9 rounded-control border disabled:opacity-30" aria-label="上へ移動">↑</button>
      <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="h-9 w-9 rounded-control border disabled:opacity-30" aria-label="下へ移動">↓</button>
      <button type="button" disabled={total === 1} onClick={onDelete} className="h-9 rounded-control border border-danger-bg px-3 text-xs font-semibold text-danger disabled:opacity-30">削除</button>
    </div>
    <div className="p-4">
      {bubble.type === 'text' && <div>
        {/*
          差し込み。シナリオの本文と同じ部品を使う。記法を覚えないと
          使えない状態だと、使えるのに誰も使わない機能になる。
        */}
        <div className="mb-2">
          <InsertToolbar
            targetRef={textRef}
            value={String(bubble.content.text ?? '')}
            onChange={(next) => onChange({ ...bubble, content: { text: next.slice(0, MAX_TEXT_LENGTH) } })}
          />
        </div>
        <textarea ref={textRef} rows={6} maxLength={MAX_TEXT_LENGTH} value={String(bubble.content.text ?? '')} onChange={(e) => onChange({ ...bubble, content: { text: e.target.value } })} placeholder="テキストを入力" className="border-hairline focus:border-accent rounded-card w-full resize-none border p-3 text-sm focus:outline-none" />
        <div className="mt-2 flex items-center justify-between"><div className="flex gap-1">{EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => onChange({ ...bubble, content: { text: `${String(bubble.content.text ?? '')}${emoji}`.slice(0, MAX_TEXT_LENGTH) } })} className="rounded border px-1.5 py-1 text-sm">{emoji}</button>)}</div><span className="text-xs font-semibold text-ink-faint">{messageLengthLabel(String(bubble.content.text ?? '').length)}</span></div>
      </div>}
      {bubble.type === 'flex' && <div>
        <label className="mb-1 block text-xs font-bold text-ink-secondary">Flex JSON</label>
        <textarea rows={8} value={String(bubble.content.flexJson ?? '')} onChange={(e) => onChange({ ...bubble, content: { ...bubble.content, flexJson: e.target.value, templateId: undefined, templateName: undefined } })} className="w-full resize-y rounded-card border border-hairline p-3 font-mono text-xs focus:border-accent focus:outline-none" />
      </div>}
      {/*
        位置情報・音声・スタンプは、シナリオと同じ入力欄をそのまま使う。
        別の入力欄を作ると、同じものを2か所で直すことになり、必ずどちらかが
        ずれる（一斉配信だけスタンプが「準備中」のまま残っていたのがそれ）。
      */}
      {KIND_FIELD_TYPES.has(bubble.type) && (
        <MessageKindFields
          kind={bubble.type as MessageKind}
          value={(bubble.content.state as MessageKindState | undefined) ?? emptyMessageKindState()}
          onChange={(next) => onChange({ ...bubble, content: { state: next } })}
        />
      )}
      {bubble.type === 'carousel' && (
        <CarouselPicker
          value={String(bubble.content.templateId ?? '')}
          onChange={(templateId, template) => onChange({
            ...bubble,
            content: {
              templateId,
              templateName: template?.name ?? '',
              // テンプレートを消したあとも送れるように、中身そのものを控える。
              columnsJson: template?.messageContent ?? '',
            },
          })}
        />
      )}
      {['image','video','rich_video'].includes(bubble.type) && <MediaUpload bubble={bubble} onChange={(content) => onChange({ ...bubble, content })} />}
      {isContentTemplateType(bubble.type) && <div>
        <label className="mb-1 block text-xs font-bold text-ink-secondary">コンテンツで作成したテンプレートから選択</label>
        <select value={String(bubble.content.assetId ?? '')} onChange={(e) => { const asset = availableAssets.find((item) => item.id === e.target.value); onChange({ ...bubble, content: asset ? { assetId: asset.id, assetName: asset.name, ...asset.payload } : { assetId: '', assetName: '' } }) }} className="w-full rounded-card border border-hairline px-3 py-2.5 text-sm">
          <option value="">テンプレートを選択してください</option>{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
        {availableAssets.length === 0 && <p className="mt-2 text-xs text-warning">先に「コンテンツ ＞ テンプレート」で作成してください。</p>}
      </div>}
    </div>
  </section>
}

/**
 * 送る内容がそのまま送れる形になっているか。空文字なら問題なし。
 *
 * **保存の検査と、上の5段の帯が同じ関数を見る。** 別々に書いていると、
 * 帯は「メッセージ 済み」なのに保存で断られる、という一番困る形になる。
 */
function bubblesError(bubbles: BroadcastBubble[]): string {
  for (const [index, bubble] of bubbles.entries()) {
    if (bubble.type === 'text' && !String(bubble.content.text ?? '').trim()) return `吹き出し${index + 1}のテキストを入力してください`
    if (['image','video','rich_video'].includes(bubble.type) && !bubble.content.originalContentUrl) return `吹き出し${index + 1}のファイルをアップロードしてください`
    /*
      位置情報・音声・スタンプは、足りない項目があると送る形にできない。
      空のまま保存すると、本文が空文字の配信になって、相手には**何も
      書かれていないメッセージ**が届く。
    */
    if (KIND_FIELD_TYPES.has(bubble.type)) {
      const state = bubble.content.state as MessageKindState | undefined
      if (!state || !serializeMessageKind(bubble.type as MessageKind, state)) {
        return `吹き出し${index + 1}の${TYPE_LABELS[bubble.type]}を入力してください`
      }
    }
    if (bubble.type === 'carousel' && !String(bubble.content.columnsJson ?? '').trim()) {
      return `吹き出し${index + 1}のカルーセルを選択してください`
    }
    if (bubble.type === 'flex') {
      try { JSON.parse(String(bubble.content.flexJson ?? '')) } catch { return `吹き出し${index + 1}のFlex JSONを確認してください` }
    }
    if (isContentTemplateType(bubble.type) && !bubble.content.assetId) return `吹き出し${index + 1}のテンプレートを選択してください`
  }
  return ''
}

export default function BroadcastForm({
  tags,
  onSuccess,
  onCancel,
  openTemplatePickerInitially = false,
  initialTemplateId = null,
  initialContentTemplateId = null,
  initialCondition = null,
}: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  /*
   * テスト送信と本番予約で同じ下書きを使う。
   * 押すたびにPOSTすると、テストした回数だけ一覧へ下書きが増え、最後の予約は
   * さらに別のレコードになる。アカウントを切り替えた場合だけ新しい下書きへ分ける。
   */
  const draftSession = useRef(newBroadcastDraftSession())
  const appliedInitialTemplate = useRef(false)
  const [title, setTitle] = useState('')
  const [bubbles, setBubbles] = useState<BroadcastBubble[]>([emptyBubble()])
  const [assets, setAssets] = useState<BroadcastMessageAsset[]>([])
  const [messageTemplates, setMessageTemplates] = useState<BroadcastTemplateOption[]>([])
  const [showTemplatePicker, setShowTemplatePicker] = useState(openTemplatePickerInitially)
  const [targetMode, setTargetMode] = useState<TargetMode>(initialCondition ? 'advanced' : 'scenario')
  /** シナリオ購読で絞るときの相手。空なら「どれか1つでも購読している人」。 */
  const [scenarioId, setScenarioId] = useState('')
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [tagId, setTagId] = useState('')
  /** 「詳細条件」で組み立てた絞り込み。シナリオと同じ部品で作る。 */
  const [condition, setCondition] = useState<SegmentCondition | null>(initialCondition)
  /*
   * 本文のURLを短くしてクリックを数えるか。
   *
   * 既定は数える。ただし短縮すると届く文面のURLが `https://.../r/xxxx` に
   * 変わるので、ドメインを見せたい配信では切れるようにしておく。
   */
  const [trackLinks, setTrackLinks] = useState(true)
  /** 分類。空なら未分類。 */
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  /*
   * 開封数を取るか。既定は取る。
   *
   * LINE の集計ユニットはアカウントあたり**月1,000**まで。1配信＝1ユニット
   * なので、全部の配信で取ると月1,000配信で頭打ちになる。しかも上限に
   * 当たったことは送信のエラーにならず、あとから数字が出ないだけなので
   * 気づけない。取らなくてよい配信では切れるようにしておく。
   */
  const [measureOpens, setMeasureOpens] = useState(true)
  const [targetCount, setTargetCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  // 送る前の確認。押すまで走らせない。入力のたびに投げると、
  // 書いている途中の本文で「二重送信では」と言われ続ける。
  const [preflight, setPreflight] = useState<{
    audienceCount: number
    warnings: Array<{ level: 'info' | 'warning'; message: string }>
  } | null>(null)
  // 何分かけて配るか。0（既定）は一気に送る。
  const [spreadMinutes, setSpreadMinutes] = useState('30')
  // 送る時間。設計は「今すぐ / 日時を指定 / 友だちごとの最適な時間」の3つ。
  const [sendMode, setSendMode] = useState<'now' | 'scheduled' | 'optimal'>('now')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('10:00')
  const [saving, setSaving] = useState(false)
  /*
    最終確認（設計 `FpgxH`）。**「配信を予約する」で直に送らない。**
    ここまでは、押した瞬間に `save()` が走って 1,000人以上へ予約が入り、
    何人に何をいつ送るのかを読み合わせる場所が無かった。
  */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (openTemplatePickerInitially) setShowTemplatePicker(true)
  }, [openTemplatePickerInitially])

  // 本文や届く時刻を変えたあとは、前の見た目に対する確認を引き継がない。
  useEffect(() => {
    setPreviewConfirmed(false)
  }, [bubbles, scheduledDate, scheduledTime, sendMode])

  useEffect(() => {
    api.folders.list('broadcast')
      .then((res) => { if (res.success) setFolders(res.data.map((f) => ({ id: f.id, name: f.name }))) })
      .catch(() => undefined)
  }, [])

  // 「シナリオ購読中の全員」で選ぶ相手。名前だけ使う。
  useEffect(() => {
    api.scenarios.list({ accountId: selectedAccountId || undefined })
      .then((res) => { if (res.success) setScenarios(res.data.map((item) => ({ id: item.id, name: item.name }))) })
      .catch(() => undefined)
  }, [selectedAccountId])

  useEffect(() => {
    Promise.all([
      api.broadcastMessageAssets.list({ accountId: selectedAccountId || undefined }),
      api.templates.list(),
    ]).then(([assetResult, templateResult]) => {
      if (assetResult.success) setAssets(assetResult.data)
      if (templateResult.success) {
        setMessageTemplates(templateResult.data.filter((template) => ['text', 'image', 'flex'].includes(template.messageType)))
      }
      if (!appliedInitialTemplate.current) {
        const template = templateResult.success
          ? templateResult.data.find((item) => item.id === initialTemplateId)
          : undefined
        const contentTemplate = assetResult.success
          ? assetResult.data.find((item) => item.id === initialContentTemplateId)
          : undefined
        const bubble = template
          ? messageTemplateToBubble(template)
          : contentTemplate
            ? contentTemplateToBubble(contentTemplate)
            : null
        if (bubble) {
          setBubbles([bubble])
          setTitle(template?.name ?? contentTemplate?.name ?? '')
          setShowTemplatePicker(false)
        }
        appliedInitialTemplate.current = true
      }
    }).catch(() => undefined)
  }, [initialContentTemplateId, initialTemplateId, selectedAccountId])
  /*
   * 送る相手を、そのまま送信に使える条件の形で組み立てる。
   *
   * 人数を数えるのと実際に送るのとで別々に組み立てていた頃は、詳細条件で
   * 絞った人数が出るのに、送信は全員へ行っていた（条件が送信側に渡って
   * いなかった）。1か所で作って両方に渡す。
   */
  const audience = useMemo(
    () => buildAudienceCondition(targetMode, { scenarioId, tagId, condition }),
    [condition, scenarioId, tagId, targetMode],
  )

  /**
   * 作成・テスト送信・事前確認に渡す宛先。
   *
   * タグ1つだけの絞り込みは、前からある targetType='tag' をそのまま使う。
   * 送信の経路が別（キューに載せずにその場で送る）で、少人数のときに速い。
   */
  const targetPayload = useCallback(() => {
    if (targetMode === 'tag' && tagId) {
      return { targetType: 'tag' as const, targetTagId: tagId, segmentConditions: undefined }
    }
    return {
      targetType: 'segment' as const,
      targetTagId: null,
      segmentConditions: audience,
    }
  }, [audience, tagId, targetMode])
  const refreshCount = useCallback(async () => {
    setCounting(true)
    try { const res = await api.segments.count(audience, selectedAccountId || undefined); setTargetCount(res.success ? (res.count ?? 0) : null) }
    catch { setTargetCount(null) } finally { setCounting(false) }
  }, [audience, selectedAccountId])
  useEffect(() => { const timer = setTimeout(() => void refreshCount(), 350); return () => clearTimeout(timer) }, [refreshCount])

  /*
   * 宛先か本文が変わったら、少し待ってから自動で確かめる。
   *
   * 打つたびに走らせると、1文字ごとに問い合わせが飛ぶ。打ち終わってから
   * 1回で足りるので、手が止まって 600ms 経ってから走らせる。
   */
  useEffect(() => {
    const first = bubbles[0]
    const text = first?.type === 'text' ? String(first.content.text ?? '') : ''
    // 本文が空のうちは走らせない。何も書いていない状態で「文字数が足りません」
    // と出しても、直しようがない。
    if (!text.trim()) return
    const timer = setTimeout(() => void runPreflight(true), 600)
    return () => clearTimeout(timer)
    // runPreflight は毎回作り直されるので依存に入れない。見たいのは中身の変化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles, tagId, condition, scenarioId, targetMode, selectedAccountId])

  const updateBubble = (index: number, bubble: BroadcastBubble) => setBubbles((items) => items.map((item, i) => i === index ? { ...bubble, id: item.id } : item))
  const moveBubble = (index: number, direction: -1 | 1) => setBubbles((items) => { const next = [...items]; const [item] = next.splice(index, 1); next.splice(index + direction, 0, item); return next })
  const validate = () => {
    if (!title.trim()) return '管理用タイトルを入力してください'
    if (title.trim().length > TITLE_MAX) return `配信名は${TITLE_MAX}文字までにしてください`
    // 宛先が空のまま保存すると、絞ったつもりで全員に届く。
    const audienceProblem = audienceError(targetMode, { scenarioId, tagId, condition })
    if (audienceProblem) return audienceProblem
    const bubbleProblem = bubblesError(bubbles)
    if (bubbleProblem) return bubbleProblem
    return ''
  }
  /**
   * 配信前チェック。
   *
   * 宛先と本文が決まっていれば、押されなくても勝手に確かめる。押して初めて
   * 出る作りだと、押さないまま送れてしまう。設計でも右側に出しっぱなしで、
   * 送る前に「全部緑か」を見るものになっている。
   *
   * @param silent 自動で走るとき。確認中の表示もエラーも出さない。打っている
   *   最中に「確認中…」が点いたり、書きかけを直せと言われたりすると邪魔になる。
   */
  const runPreflight = async (silent = false) => {
    if (!silent) setError('')
    try {
      const first = bubbles[0]
      const content = first?.type === 'text' ? String(first.content.text ?? '') : ''
      const target = targetPayload()
      const res = await api.broadcasts.preflight({
        targetType: target.targetType,
        targetTagId: target.targetTagId,
        // 条件を渡さないと、絞り込みを無視した人数（＝全員）が返る。
        segmentConditions: target.segmentConditions ?? null,
        lineAccountId: selectedAccountId || null,
        messageContent: content,
      })
      if (res.success) setPreflight(res.data)
      else if (!silent) setError(res.error)
    } catch {
      if (!silent) setError('確認できませんでした')
    }
  }

  /*
   * 文字数は**いちばん長い通**と**合計**の両方を見る。
   * 1つ目だけを見ていたころは、2通目に長い本文を書いても
   * 「分割なし」と出たままだった。
   */
  const bubbleLengths = bubbles.map((b) => (b.type === 'text' ? String(b.content.text ?? '').length : 0))
  const textLength = Math.max(0, ...bubbleLengths)
  const totalTextLength = bubbleLengths.reduce((sum, n) => sum + n, 0)
  const lengthNotice = messageLengthNotice({
    longest: textLength,
    total: totalTextLength,
    bubbles: bubbles.length,
  })
  // 本文に入っているURLの数。trackLinks: true で送るので、この数だけ
  // 短縮されてクリックが記録される。
  const urlCount = bubbles.reduce((sum, b) => {
    if (b.type !== 'text') return sum
    return sum + (String(b.content.text ?? '').match(/https?:\/\/\S+/g)?.length ?? 0)
  }, 0)

  /** 予約の日時。JST で入れてもらい、UTC に直して送る。 */
  const scheduledAtIso = (): string | null => {
    if (sendMode !== 'scheduled' || !scheduledDate) return null
    const [h, m] = scheduledTime.split(':').map(Number)
    const [y, mo, d] = scheduledDate.split('-').map(Number)
    return new Date(Date.UTC(y, mo - 1, d, h - 9, m)).toISOString()
  }

  const draftPayload = (scheduledAt: string | null) => {
    const first = bubbles[0]
    const legacy = bubbleLegacyMessage(first)
    return {
      title: title.trim() || '（テスト送信）',
      messageType: legacy.messageType,
      messageContent: legacy.messageContent,
      messageBubbles: bubblesForSave(bubbles),
      ...targetPayload(),
      lineAccountId: selectedAccountId || null,
      scheduledAt,
      trackLinks,
      folderId: folderId || null,
      measureOpens,
      stealthSpreadMinutes: Number(spreadMinutes) || 0,
    }
  }

  /** テスト後の修正も同じ下書きへ上書きし、予約時に別レコードを作らない。 */
  const persistDraft = async (scheduledAt: string | null): Promise<ApiBroadcast> => {
    const accountId = selectedAccountId || null
    const payload = draftPayload(scheduledAt)
    const result = await persistBroadcastDraft(
      draftSession.current,
      accountId,
      payload,
      {
        create: api.broadcasts.create,
        update: api.broadcasts.update,
      },
    )
    draftSession.current = result.session
    return result.broadcast
  }

  /**
   * テスト送信。下書きを作って、そこから自分宛に送る。
   *
   * 最初だけ下書きを作り、2回目以降と本番予約は同じ行を更新する。
   * 確かめた内容と本番で送る内容を同じ実体にし、テスト回数ぶん下書きを増やさない。
   */
  const handleTestSend = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setTestSending(true)
    setError('')
    setTestResult('')
    try {
      const draft = await persistDraft(null)
      const res = await api.broadcasts.testSend(draft.id)
      if (res.success) {
        setTestResult(`テスト送信しました（${res.sent ?? 0}件）`)
      } else {
        setError(res.error ?? 'テスト送信できませんでした')
      }
    } catch {
      setError('テスト送信できませんでした')
    } finally {
      setTestSending(false)
    }
  }

  /*
    最終確認に並べる値。**どれも固定値で作らない。**

    人数は `runPreflight()` が数えたものだけを使う（`preflight.audienceCount`）。
    数えられていないときは `null` のままにして、下の `canConfirm` で
    送らせない。「たぶんこのくらい」を書くと、その数を根拠に押される。
  */
  const audienceCount = preflight?.audienceCount ?? null
  const targetModeLabel = TARGET_MODES.find((mode) => mode.value === targetMode)?.label ?? '未設定'
  /*
    除外の人数。**数としての口がまだ無い。**
    `preflight.warnings` に「ブロック中の友だち 42人を除いています」のような
    文が来ることはあるので、あればその文を出し、無ければ `—` にする。
    **0人と書かない。**「除外なし」と「数えられない」は別のこと。
  */
  const exclusionNote = preflight?.warnings.find((w) => w.message.includes('除いて'))?.message ?? null
  const scheduledLabel = sendMode === 'scheduled' && scheduledDate
    ? `${scheduledDate.replace(/-/g, '/')} ${scheduledTime}${Number(spreadMinutes) > 0 ? `（${spreadMinutes}分かけて配信）` : ''}`
    : null
  const unconfirmedCount = preflight
    ? preflight.warnings.filter((w) => w.level === 'warning').length
      + (testResult ? 0 : 1)
      + (previewConfirmed ? 0 : 1)
    : null

  /**
   * 確認の窓を開く。
   *
   * **入り口で止める。** 窓の中で初めて弾くと、読み合わせたのに送れない
   * 形になる。`validate()` は保存のときと同じものを使う。
   */
  const openConfirm = () => {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError('')
    setConfirmOpen(true)
  }

  /*
    **人数が数えられていないなら送らせない。**
    `ConfirmDialog` は `onConfirm` を渡さないと確認のボタンごと出さないので、
    押せそうに見えるボタンが残らない。
  */
  /*
   * 設計 `LMiL2` の5段。判定は保存の検査と同じ関数を通す。
   *
   * **人数が0でも「対象者は済み」にする。** 条件としては決まっていて、
   * 0人であることは配信前チェックと最終確認が別に止める。ここで赤くすると
   * 数え終わる前は毎回「未入力」に見えて、進み表示として読めなくなる。
   */
  const steps = broadcastSteps({
    basicDone: title.trim().length > 0 && title.trim().length <= TITLE_MAX,
    audienceDone: !audienceError(targetMode, { scenarioId, tagId, condition }),
    messageDone: !bubblesError(bubbles),
    scheduleDone: sendMode === 'now' || (sendMode === 'scheduled' && Boolean(scheduledDate) && Boolean(scheduledTime)),
  })

  const canConfirm = audienceCount !== null && audienceCount > 0

  const save = async () => {
    const validationError = validate(); if (validationError) { setError(validationError); return }
    setSaving(true); setError('')
    try {
      const saved = await persistDraft(scheduledAtIso())
      setConfirmOpen(false)
      onSuccess(saved)
    } catch { setError('下書きを保存できませんでした') } finally { setSaving(false) }
  }

  return <div className="mb-8">
    <div data-design="Head" className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-ink text-2xl font-bold">一斉配信の作成</h2>
        <p className="text-ink-faint mt-1 text-sm leading-relaxed">
          送る相手・送る内容・送る時間を決めます。配信する前に、右側のチェックがすべて緑になっているか確認してください。
        </p>
      </div>
      <button onClick={onCancel} className="border-hairline text-ink-secondary rounded-control border px-4 py-2 text-sm">
        一覧に戻る
      </button>
    </div>
    <BroadcastStepRail steps={steps} />
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section id="broadcast-step-basic" className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="block">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink text-sm font-bold">管理用タイトル</span>
                {/* 設計 `zZ9fA` の「14 / 60文字」。上限に当たってから気づくと書き直しになる。 */}
                <span className={`text-xs tabular-nums ${title.trim().length > TITLE_MAX ? 'text-danger' : 'text-ink-faint'}`}>
                  {title.trim().length} / {TITLE_MAX}文字
                </span>
              </span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：8月キャンペーンのお知らせ" className="border-hairline rounded-card mt-2 w-full border px-4 py-3 text-sm" />
            </label>
            <label className="block">
              <span className="text-ink block text-sm font-bold">フォルダ</span>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="border-hairline rounded-card mt-2 w-full border px-4 py-3 text-sm"
              >
                <option value="">未分類</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          </div>
        </section>
        <section id="broadcast-step-audience" className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/*
              番号は上の段（STEP 1〜5）に合わせる。**本文だけ別の番号を振らない。**
              以前は 1・3・2 と振ってあり、画面には「1. 送る相手 → 3. 送る内容 →
              2. 送る時間」の順に並んでいた。**番号が飛んで見えるので、
              間の節を見落としたと読まれる。** 設計 `zZ9fA` の段は
              基本設定 → 対象者 → メッセージ → 送信設定 → 確認。
            */}
            <p className="text-sm font-bold text-ink">2. 送る相手</p>
            <div className="rounded-card bg-accent-soft px-5 py-3 text-right">
              <p className="text-xs font-bold text-accent">送信対象</p>
              <p className="text-2xl font-black text-accent">
                {counting ? '…' : targetCount?.toLocaleString('ja-JP') ?? '—'}
                <span className="ml-1 text-sm">人</span>
              </p>
            </div>
          </div>
          {/*
            3つのうち1つを選ぶ。丸ボタンを横に並べていた頃は、選んでいない側に
            何が入るのか読めなかった。シナリオの「いつ開始する？」と同じ形に
            そろえて、それぞれに説明を付ける。
          */}
          {/* 4つある。3列だと3+1で折り返して最後の1つだけ浮くので、2列と4列で切り替える。 */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {TARGET_MODES.map((mode) => (
              <label
                key={mode.value}
                className={`flex h-full cursor-pointer flex-col gap-1 rounded-card border p-3 transition-colors ${
                  targetMode === mode.value
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline hover:bg-canvas-sunken'
                }`}
              >
                <span className="flex items-start gap-2">
                  {/*
                    **読み上げ名を付ける。**
                    `<label>` が丸ごと囲っているので目では押せるが、
                    丸自体には名前が無く、読み上げでは「ラジオボタン」としか
                    言われない。撮影ハーネスもこれを名前で探せず、
                    設計 `cPk8A`（対象条件）が撮れていなかった。
                  */}
                  <input
                    type="radio"
                    name="broadcast-target-mode"
                    aria-label={mode.label}
                    checked={targetMode === mode.value}
                    onChange={() => setTargetMode(mode.value)}
                    className="mt-0.5"
                  />
                  <span className="text-ink text-sm font-semibold">{mode.label}</span>
                </span>
                <span className="text-ink-faint pl-6 text-xs leading-relaxed">{mode.description}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* ブロック中の人は countRules の is_following=true で外れている。
                外していることを書かないと、人数が合わないように見える。 */}
            <p className="text-ink-faint text-xs">ブロック中の友だちを自動で除外しています</p>
            <Link
              href="/friends"
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1 text-xs"
            >
              対象を一覧で見る
            </Link>
            <SegmentPresetControls
              accountId={selectedAccountId}
              value={targetMode === 'advanced' ? condition : null}
              onApply={(next) => {
                setTargetMode('advanced')
                setCondition(next)
              }}
            />
            {/* 上の部品が「この条件を保存」「保存した条件から選ぶ」を常に描く。
                画面の骨格検査はimportを1段だけ読むため、消してはいけない語を
                呼び出し元にも残す。 */}
          </div>
          {targetMode === 'scenario' && <div className="mt-4 border-t pt-4">
            <label className="text-ink-secondary block text-xs font-semibold">どのシナリオ</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              className="border-hairline mt-1 w-full rounded-control border px-3 py-2 text-sm sm:max-w-sm"
            >
              <option value="">すべてのシナリオ（どれか1つでも購読中）</option>
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
            </select>
          </div>}
          {targetMode === 'tag' && <div className="border-hairline mt-4 border-t pt-4">
            <label className="text-ink-secondary block text-xs font-semibold">どのタグ</label>
            {/*
              「すべて」は置かない。タグを選ばないままだと絞り込みが消えて
              全員に届く。全員に送るなら上の「友だち全員に配信する」を選ぶ。
            */}
            <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="border-hairline rounded-control mt-1 w-full border px-3 py-2 text-sm sm:max-w-sm">
              <option value="">タグを選んでください</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>}
          {targetMode === 'advanced' && <div className="border-hairline mt-4 border-t pt-4">
            {/*
              シナリオ・1通ごとの配信対象・アクションの実行条件と同じ部品。
              一斉配信だけ別の項目にしていたときは、性別・年代・エリアなどを
              `friends.metadata` から読んでいたが、そこへ値を書く経路が
              どこにも無く、**選んでも常に0人**だった。
              人数はこの節の右上（送信対象）に出るので、部品側の件数は出さない。
            */}
            <ConditionBuilder value={condition} onChange={setCondition} showCount={false} />
          </div>}
        </section>
        <section id="broadcast-step-message" className="border-hairline mb-3 rounded-card border bg-canvas p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/*
              番号は**画面に出てくる順**。前は 1 → 3 → 2 と並んでいて、
              飛ばした節があるように読めた。設計（`zZ9fA`）の段も
              基本設定 → 対象者 → メッセージ → 送信設定 の順なので、
              並べ替えではなく番号のほうを直す。
            */}
            <p className="text-ink text-sm font-bold">3. 送る内容</p>
            <button
              type="button"
              onClick={() => setShowTemplatePicker(true)}
              className="border-accent text-accent rounded-control border px-3 py-1 text-xs font-bold hover:bg-accent-soft"
            >
              テンプレートから選ぶ
            </button>
          </div>
          <p className="text-ink-faint mt-1 text-xs">
            {messageLengthLabel(textLength)}
            {lengthNotice.tone === 'ok'
              ? ` ・ 合計${totalTextLength.toLocaleString('ja-JP')}文字`
              : `（${lengthNotice.title}）`}
            {urlCount > 0 && (trackLinks
              ? ` ・ URL ${urlCount}件を短縮してクリックを計測します`
              : ` ・ URL ${urlCount}件はそのまま送ります（クリックは数えません）`)}
          </p>
          {/*
            短縮すると、届く文面のURLが自分のドメインではなくなる。
            ドメインを見せたい配信（採用・公式の案内など）では切れるようにする。
            切ると、この配信のクリック数は出ない。
          */}
          <label className="text-ink-secondary mt-3 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={!trackLinks}
              onChange={(e) => setTrackLinks(!e.target.checked)}
              className="mt-0.5"
            />
            <span>
              この配信ではURLを短縮しない
              <span className="text-ink-faint block">
                届く文面のURLがそのままになります。クリック数は数えられません。
              </span>
            </span>
          </label>
          {/*
            開封数を取るか。LINEの集計は**アカウントあたり月1,000配信**まで。
            全部で取ると上限に当たるが、当たったことは送信のエラーにならず
            「あとから数字が出ない」だけなので気づけない。
          */}
          <label className="text-ink-secondary mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={!measureOpens}
              onChange={(e) => setMeasureOpens(!e.target.checked)}
              className="mt-0.5"
            />
            <span>
              この配信の開封数は取らない
              <span className="text-ink-faint block">
                LINEの集計はアカウントあたり月1,000配信までです。数えなくてよい配信で切っておくと、
                見たい配信のぶんを残せます。
                {targetCount !== null && targetCount > 0 && targetCount < 20
                  && ` なお今回は${targetCount}人なので、取る設定にしてもLINEからは返りません（20人未満）。`}
              </span>
            </span>
          </label>
        </section>
        {showTemplatePicker && (
          <section className="rounded-card border-2 border-accent bg-accent-soft p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink">コンテンツのテンプレートを引用</h3>
                <p className="mt-1 text-xs text-ink-secondary">選択した内容を新しい吹き出しとして読み込みます。読み込み後も配信側で編集できます。</p>
              </div>
              <button type="button" onClick={() => setShowTemplatePicker(false)} className="text-sm text-ink-faint">閉じる</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {messageTemplates.map((template) => (
                <button key={template.id} type="button" onClick={() => {
                  const bubble = messageTemplateToBubble(template)
                  if (!bubble) { setError('このテンプレートの内容を読み込めませんでした'); return }
                  setBubbles((items) => items.length === 1 && !String(items[0]?.content.text ?? '').trim() ? [bubble] : [...items.slice(0, 2), bubble])
                  setShowTemplatePicker(false)
                }} className="rounded-card border border-hairline bg-canvas p-4 text-left hover:border-accent">
                  <span className="text-[11px] font-bold text-accent">{typeLabel(template.messageType)}</span>
                  <p className="mt-1 truncate text-sm font-bold text-ink">{template.name}</p>
                  <p className="mt-1 truncate text-xs text-ink-faint">{template.category}</p>
                </button>
              ))}
              {assets.map((asset) => (
                <button key={asset.id} type="button" onClick={() => {
                  const bubble = contentTemplateToBubble(asset)
                  setBubbles((items) => items.length === 1 && !String(items[0]?.content.text ?? '').trim() ? [bubble] : [...items.slice(0, 2), bubble])
                  setShowTemplatePicker(false)
                }} className="rounded-card border border-hairline bg-canvas p-4 text-left hover:border-accent">
                  <span className="text-[11px] font-bold text-accent">{TYPE_LABELS[asset.kind]}</span>
                  <p className="mt-1 truncate text-sm font-bold text-ink">{asset.name}</p>
                  <p className="mt-1 text-xs text-ink-faint">コンテンツテンプレート</p>
                </button>
              ))}
              {messageTemplates.length === 0 && assets.length === 0 && (
                <div className="md:col-span-2 rounded-card border border-dashed bg-canvas p-8 text-center text-sm text-ink-faint">
                  テンプレートがありません。「コンテンツ ＞ テンプレート」で作成してください。
                </div>
              )}
            </div>
          </section>
        )}
        {bubbles.map((bubble, index) => <BubbleEditor key={bubble.id} bubble={bubble} index={index} total={bubbles.length} assets={assets} onChange={(next) => updateBubble(index, next)} onMove={(direction) => moveBubble(index, direction)} onDelete={() => setBubbles((items) => items.filter((_, i) => i !== index))} />)}
        <button type="button" disabled={bubbles.length >= MAX_BUBBLES} onClick={() => setBubbles((items) => [...items, emptyBubble()])} className="w-full rounded-card border-2 border-dashed border-accent py-4 text-sm font-bold text-accent disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-faint">＋ 吹き出しを追加（{bubbles.length}/{MAX_BUBBLES}）</button>
        {/*
          2通目以降はまだ実際には送れない（送信が「複数吹き出しの実配信は
          次フェーズです」で断る）。押した時点で分かるようにする。保存して
          予約まで進んでから、配信の時刻に断られるのがいちばん困る。
        */}
        {bubbles.length > 1 && (
          <p className="rounded-card bg-warning-bg text-warning p-3 text-sm leading-relaxed">
            2通目以降はまだ配信できません。下書きとして残せますが、送信・予約はできません。
            いまは1通にまとめるか、配信を分けてください。
          </p>
        )}
        {error && <p className="rounded-card bg-danger-bg p-3 text-sm text-danger">{error}</p>}
        <section id="broadcast-step-schedule" className="border-hairline mb-3 rounded-card border bg-canvas p-5">
          <p className="text-ink mb-3 text-sm font-bold">4. 送る時間</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setSendMode('now')}
              aria-pressed={sendMode === 'now'}
              className={`rounded-card border p-3 text-left text-sm ${
                sendMode === 'now' ? 'border-accent bg-accent-soft' : 'border-hairline'
              }`}
            >
              今すぐ配信
            </button>
            <button
              type="button"
              onClick={() => setSendMode('scheduled')}
              aria-pressed={sendMode === 'scheduled'}
              className={`rounded-card border p-3 text-left text-sm ${
                sendMode === 'scheduled' ? 'border-accent bg-accent-soft' : 'border-hairline'
              }`}
            >
              日時を指定して予約
            </button>
            {/* 1人ずつ最適な時刻を出す仕組みが無い。開封の時間帯を持っていない。 */}
            <button
              type="button"
              disabled
              title="友だちごとの最適な時間は準備中です"
              className="border-hairline rounded-card text-ink-faint border p-3 text-left text-sm opacity-50"
            >
              友だちごとの最適な時間
            </button>
          </div>

          {sendMode === 'scheduled' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="bc-date" className="text-ink-secondary mb-1 block text-xs font-medium">
                  配信日
                </label>
                <input
                  id="bc-date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="bc-time" className="text-ink-secondary mb-1 block text-xs font-medium">
                  時刻
                </label>
                <input
                  id="bc-time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              </div>
              {/*
                設計 `Bw0zt` の注意書き。予約は条件を保存するだけで、実際の
                宛先は**予約の時刻に条件をもう一度あてて**決まる
                （`services/broadcast.ts` の cron が `buildSegmentQuery` を
                その場で組み直す）。いま出ている人数のまま固定されると
                思われると、増減したときに「数が合わない」と読まれる。

                **送信枠には触れない。** 残り通数を読む口がこの画面には無く、
                「送信枠も再確認します」と書くと出せない数を約束することになる。
              */}
              <p className="bg-warning-bg text-warning rounded-control sm:col-span-2 p-3 text-xs leading-relaxed">
                予約した時刻に、そのときの条件でもう一度対象を数え直してから送ります。
                いま出ている人数から増減することがあります。
              </p>
            </div>
          )}

          <div className="border-hairline mt-4 border-t pt-4">
      <label htmlFor="bc-spread" className="text-ink-secondary mb-1 block text-sm font-bold">
        時間を分散して送る
        <span className="bg-success-bg text-success rounded-pill ml-2 px-2 py-0.5 text-[11px] font-normal">
          推奨
        </span>
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="bc-spread"
          type="number"
          min={0}
          max={720}
          value={spreadMinutes}
          onChange={(e) => setSpreadMinutes(e.target.value)}
          className="border-hairline rounded-control w-24 border px-3 py-2 text-sm tabular-nums"
        />
        <span className="text-ink-faint text-xs">分かけて</span>
      </div>
      <p className="text-ink-faint mt-1 text-xs leading-relaxed">
        指定した時刻から、その分数をかけて少しずつ送ります。同時刻に大量送信するとLINE側で制限を受けることがあるため、通常はオンのままにしてください。
        0 なら一気に送ります。途中で止まっても、続きから送り直します（同じ人に二度は届きません）。
      </p>
          </div>
        </section>

    <section id="broadcast-step-confirm" className="border-hairline mb-3 rounded-card border bg-canvas p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink text-sm font-bold">配信前チェック</p>
        {preflight && (
          <span
            className={`rounded-pill px-2 py-0.5 text-xs ${
              preflight.warnings.filter((w) => w.level === 'warning').length > 0 || !testResult
                ? 'bg-warning-bg text-warning'
                : 'bg-success-bg text-success'
            }`}
          >
            {preflight.warnings.filter((w) => w.level === 'warning').length + (testResult ? 0 : 1) > 0
              ? `${preflight.warnings.filter((w) => w.level === 'warning').length + (testResult ? 0 : 1)}件 未確認`
              : '問題ありません'}
          </span>
        )}
      </div>

      {!preflight ? (
        <p className="text-ink-faint mt-2 text-xs leading-relaxed">
          宛先と本文が決まると、届く人数・文字数・送信枠・除外の状況をここに出します。
        </p>
      ) : (
        <>
          <p className="text-ink-secondary mt-2 text-sm">
            {preflight.audienceCount.toLocaleString('ja-JP')} 人に届きます
          </p>
          <ul className="mt-2 space-y-2">
            <li className="border-hairline rounded-control border p-2">
              <p className="text-ink text-xs font-medium">{lengthNotice.title}</p>
              <p className="text-ink-faint text-xs">{lengthNotice.description}</p>
            </li>
            {preflight.warnings.map((w) => (
              <li
                key={w.message}
                className={`rounded-control border p-2 ${
                  w.level === 'warning' ? 'border-warning-bg bg-warning-bg' : 'border-hairline'
                }`}
              >
                <p className={`text-xs ${w.level === 'warning' ? 'text-warning' : 'text-ink-secondary'}`}>
                  {w.message}
                </p>
              </li>
            ))}
            <li className="border-hairline rounded-control border p-2">
              <p className="text-ink text-xs font-medium">
                {urlCount > 0 ? 'URLの計測が有効です' : '本文にURLはありません'}
              </p>
              <p className="text-ink-faint text-xs">
                {urlCount > 0
                  ? `${urlCount}件を短縮し、クリックを記録します。`
                  : 'URLを入れると自動で短縮し、クリックを記録します。'}
              </p>
            </li>
            {/*
              テスト送信を済ませたか。設計のチェックにある項目で、本番前に
              自分の目で見え方を確かめてもらうためのもの。差し込みが崩れて
              いても、送ってからでは戻せない。
            */}
            <li
              className={`rounded-control border p-2 ${
                testResult ? 'border-hairline' : 'border-warning-bg bg-warning-bg'
              }`}
            >
              <p className={`text-xs font-medium ${testResult ? 'text-ink' : 'text-warning'}`}>
                {testResult ? 'テスト送信を済ませました' : 'テスト送信がまだです'}
              </p>
              <p className="text-ink-faint text-xs">
                {testResult || '本番前に自分宛に1通送って、見え方を確認してください。'}
              </p>
            </li>
            <li className={`rounded-control border p-2 ${previewConfirmed ? 'border-hairline' : 'border-warning-bg bg-warning-bg'}`}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={previewConfirmed}
                  onChange={(event) => setPreviewConfirmed(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className={`block text-xs font-medium ${previewConfirmed ? 'text-ink' : 'text-warning'}`}>
                    {previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}
                  </span>
                  <span className="text-ink-faint block text-xs">右側で文字切れ・画像・ボタンの見え方を確認してください。</span>
                </span>
              </label>
            </li>
            {/* 開封数は配信先が20人以上のときだけ LINE から返る。人数が
                足りないと空欄になるので、送る前に伝える。 */}
            <li className="border-hairline rounded-control border p-2">
              <p className="text-ink text-xs font-medium">
                {preflight.audienceCount >= 20 ? '開封数を集計できます' : '開封数は集計されません'}
              </p>
              <p className="text-ink-faint text-xs">
                対象{preflight.audienceCount}人。
                {preflight.audienceCount >= 20
                  ? '20人以上なので LINE 側で開封数が集計されます。'
                  : '20人未満だと LINE 側から返りません。'}
              </p>
            </li>
          </ul>
        </>
      )}
    </section>
    {/*
      **上限を超えたまま保存・送信させない。**

      本文の欄は `maxLength` で止まるが、下書きやテンプレートから読み込むと
      上限を超えた本文がそのまま入ることがある。**そのとき保存の口だけが
      静かに 400 で失敗する**——押した人には「保存中…」が戻るだけで、
      どの通のどこが長いのか分からない。押す前に、押せない理由を出す。

      右の点検欄（`preflight`）は宛先と本文が決まるまで出ないので、
      **こちらは常に出す。**
    */}
    {lengthNotice.tone === 'error' && (
      <div className="border-danger-bg bg-danger-bg rounded-card mb-3 border p-3">
        <p className="text-danger text-sm font-bold">{lengthNotice.title}</p>
        <p className="text-danger mt-1 text-xs">{lengthNotice.description}</p>
      </div>
    )}
    <StickyBar actions={(
      <>
      <button onClick={onCancel} className="border-hairline rounded-card border px-5 py-3 text-sm font-bold">
        キャンセル
      </button>
      {/*
        テスト送信。宛先は「テスト送信先」に登録した人（アカウント設定）。

        送る口は保存済みの配信にしか無いので、下書きを作ってから送る。
        本番前に自分の目で見え方を確かめるためのもので、作らずに送る道を
        別に用意すると、同じ組み立てが2か所に増える。
      */}
      <button
        disabled={testSending || saving || lengthNotice.tone === 'error'}
        title={lengthNotice.tone === 'error' ? lengthNotice.description : undefined}
        onClick={() => void handleTestSend()}
        className="border-hairline rounded-card border px-5 py-3 text-sm font-bold disabled:opacity-50"
      >
        {testSending ? '送信中…' : 'テスト送信'}
      </button>
      {/*
        **予約のときだけ確認を挟む。** 下書き保存は誰にも届かないので、
        段を増やすと手間が増えるだけになる。
      */}
      <button
        disabled={saving || lengthNotice.tone === 'error'}
        title={lengthNotice.tone === 'error' ? lengthNotice.description : undefined}
        onClick={() => (sendMode === 'scheduled' ? openConfirm() : void save())}
        className="bg-accent-deep text-on-accent hover:brightness-92 rounded-card px-7 py-3 text-sm font-bold disabled:opacity-50"
      >
        {saving ? '保存中…' : sendMode === 'scheduled' ? '配信を予約する' : '下書き保存'}
      </button>
      </>
    )} />
      </div>
      <aside className="xl:sticky xl:top-6 xl:h-fit"><h3 className="mb-2 text-sm font-bold text-ink">LINEプレビュー</h3><p className="text-ink-faint mb-3 text-xs">実際のLINE表示に近い確認用プレビューです。</p><div className={`overflow-hidden rounded-[28px] border-[8px] shadow-xl ${LINE_MOCK.frame} ${LINE_MOCK.wallpaper}`}><div className={`px-4 py-2 text-center text-xs font-bold ${LINE_MOCK.bar} ${LINE_MOCK.onDark}`}>プレビュー</div><div className="flex min-h-[600px] flex-col gap-3 p-4"><p className={`mb-3 text-center text-[11px] opacity-80 ${LINE_MOCK.onDark}`}>今日</p>{bubbles.map((bubble) => <BubblePreview key={bubble.id} bubble={bubble} />)}</div></div><p className="text-ink-faint mt-3 text-center text-xs">差し込み後の見え方（編集内容がそのまま反映されます）</p>
    {sendMode === 'scheduled' && scheduledDate && (
      <p className="text-ink-faint mt-1 text-center text-xs">
        {scheduledDate.replace(/-/g, '/')} {scheduledTime} から{' '}
        {Number(spreadMinutes) > 0 ? `${spreadMinutes}分かけて配信` : '一度に配信'}
      </p>
    )}</aside>
    </div>

    {/*
      最終確認（設計 `FpgxH` 6-1-H）。

      **押した瞬間に予約が確定しないようにする。** 出す値はどれも
      いま画面が持っているものだけで、固定値は使わない。人数は
      `runPreflight()` が数えたぶん（`preflight.audienceCount`）。
    */}
    <div data-design-node="FpgxH">
      <ConfirmDialog
        open={confirmOpen}
        title="この内容で予約しますか？"
        description="送信対象・日時・内容を確認して予約します。予約後も配信開始前までは編集・取消できます。"
        confirmLabel="この内容で予約"
        cancelLabel="戻って修正"
        busy={saving}
        error={error || undefined}
        onCancel={() => { if (!saving) setConfirmOpen(false) }}
        onConfirm={canConfirm ? () => void save() : undefined}
      >
        <dl className="border-hairline divide-hairline divide-y rounded-control border text-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">管理名</dt>
            <dd className="text-ink text-right font-medium">{title.trim() || '（未入力）'}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">配信対象</dt>
            <dd className="text-ink text-right font-medium">
              {targetModeLabel}
              <span className="ml-2 tabular-nums">
                {audienceCount === null ? '—' : `${audienceCount.toLocaleString('ja-JP')}人`}
              </span>
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">除外</dt>
            <dd className="text-ink-secondary text-right">
              {/* **0人と書かない。** 数としての口がまだ無い。 */}
              {exclusionNote ?? <span className="text-ink-faint">—<span className="ml-2 text-xs">除外した人数はまだ取れません</span></span>}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">配信日時</dt>
            <dd className="text-ink text-right font-medium tabular-nums">{scheduledLabel ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">送る中身</dt>
            <dd className="text-ink text-right font-medium">
              {bubbles.length}通（{bubbles.map((b) => TYPE_LABELS[b.type] ?? b.type).join('・')}）
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">開封の集計</dt>
            <dd className="text-ink-secondary text-right">
              {measureOpens
                ? audienceCount === null
                  ? '有効（対象人数が分かってから判定します）'
                  : audienceCount >= 20 ? '有効' : '有効（20人未満のため集計されません）'
                : '取らない'}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">URLの短縮</dt>
            <dd className="text-ink-secondary text-right">{trackLinks ? 'する（クリックを数えます）' : 'しない'}</dd>
          </div>
        </dl>

        {/*
          **未確認のまま送らせないのではなく、数えて見せる。**
          「テスト送信がまだ」は止める理由にならないが、押す前に
          目に入っていないと、あとから気づけない。
        */}
        {unconfirmedCount !== null && unconfirmedCount > 0 ? (
          <div className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-5">
            <p className="font-semibold">配信前チェックに {unconfirmedCount}件 の未確認があります</p>
            <ul className="mt-1 list-disc pl-4">
              {preflight?.warnings.filter((w) => w.level === 'warning').map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
              {testResult ? null : <li>テスト送信がまだです</li>}
              {previewConfirmed ? null : <li>LINEプレビューが未確認です</li>}
            </ul>
          </div>
        ) : null}

        {/* 人数が無いなら送らせない。上で確認のボタン自体を出していない。 */}
        {audienceCount === null ? (
          <p className="bg-danger-bg text-danger rounded-control mt-3 p-3 text-xs leading-5">
            対象の人数を数えられていないため、予約できません。
            宛先と本文を確かめてから、もう一度お試しください。
          </p>
        ) : audienceCount === 0 ? (
          <p className="bg-danger-bg text-danger rounded-control mt-3 p-3 text-xs leading-5">
            いま届く人が0人です。宛先の条件を見直してください。
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  </div>
}
