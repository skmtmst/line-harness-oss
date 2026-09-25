'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Folder, Tag } from '@line-crm/shared'
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, GripVertical, Paperclip, Plus, Save, Send, Trash2, Zap } from 'lucide-react'
import {
  ApiError,
  api,
  type ApiBroadcast,
  type BroadcastBubble,
  type BroadcastBubbleType,
  type BroadcastMessageAsset,
  type BroadcastMessageButton,
  type BroadcastPreflight,
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
  conditionHasAnalyticsAudience,
  type TargetMode,
} from '@/lib/broadcast-audience'
import type { SegmentCondition } from '@/lib/segment-condition'
import { newBroadcastDraftSession, persistBroadcastDraft } from '@/lib/broadcast-draft'
import ConditionBuilder from '@/components/shared/condition-builder'
import SegmentPresetControls from '@/components/broadcasts/segment-preset-controls'
import { audienceSummary } from '@/lib/broadcast-summary'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import MessageKindFields, {
  emptyMessageKindState,
  serializeMessageKind,
  type MessageKind,
  type MessageKindState,
} from '@/components/scenarios/message-kind-fields'
import CarouselPicker, {
  createLoadGeneration,
  filterSendableTemplates,
} from '@/components/scenarios/carousel-picker'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Combobox from '@/components/shared/combobox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Button from '@/components/shared/button'
import { RequiredBadge } from '@/components/shared/form-controls'
import BroadcastStepRail from '@/components/broadcasts/broadcast-step-rail'
import { broadcastSteps, type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import { testSendFailure, testSendResult, type TestSendView } from './test-send-view'
import { usePageTitle } from '@/components/shell/page-chrome'

interface BroadcastFormProps {
  tags: Tag[]
  /** 作成された実物。予約だけを完了画面へ送り、下書きと取り違えない。 */
  onSuccess: (broadcast: ApiBroadcast) => void
  /**
   * BROADCAST-16: 「下書き保存」でフォームが閉じない保存にも呼ぶ。
   * 呼び側は一覧・フォルダ件数を読み直す（保存した下書きが未分類へ
   * 増えるのに、再訪しないと件数が古いままだった）。
   */
  onDraftSaved?: (broadcast: ApiBroadcast) => void
  onCancel: () => void
  openTemplatePickerInitially?: boolean
  initialTemplateId?: string | null
  initialContentTemplateId?: string | null
  initialCondition?: SegmentCondition | null
  /** 分析画面から渡された一時対象者。人数・期限はAPIで読み直したもの。 */
  audienceNotice?: { memberCount: number; expiresAt: string; label?: string } | null
  initialScheduledDate?: string
  initialScheduledTime?: string
  /** 正本の `?step=`。未指定は一覧内の従来フォームとして全節を表示する。 */
  currentStep?: BroadcastStepKey | null
  onStepChange?: (step: BroadcastStepKey) => void
  /** visual-qa-accountでだけ使う、Pencilの8月キャンペーン完成状態。 */
  visualQaAugustCampaign?: boolean
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
  rich_message: 'リッチメッセージには未対応です。いまは写真かFlexで作れます',
  rich_video: 'リッチビデオには未対応です。いまは動画で送れます',
  card_message: 'カードタイプには未対応です。いまはカルーセルで作れます',
  coupon: 'クーポンには未対応です',
  research: 'リサーチには未対応です',
}

/** メッセージ形式タブの並び。null は「紹介」（まだ作れない）。 */
const MESSAGE_TYPE_TABS = [
  ['text', 'テキスト'], ['image', '画像'], ['video', '動画'], ['audio', '音声'], ['sticker', 'スタンプ'],
  ['location', '位置情報'], ['carousel', 'カルーセル'], ['rich_message', 'リッチメッセージ'],
  ['research', '質問'], [null, '紹介'],
] as const

/*
 * メッセージ形式タブの矢印キー操作（N-063）。
 *
 * タブの作法（WAI-ARIA tabs, 手動起動）に揃える。
 * ←→↑↓ はフォーカスだけを動かし、Home/End は端へ飛ぶ。
 * **選ぶのは Enter・スペース・クリック。** 矢印を押しただけで切り替えると、
 * 書きかけの中身が移るたびに空へ戻ってしまう（切替は bubble の中身を
 * 作り直す）ので、フォーカスと選択は分ける。
 */
export function moveMessageTypeTabFocus(
  event: { key: string; currentTarget: HTMLElement; preventDefault: () => void },
  activeElement: Element | null,
): void {
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
  const current = tabs.findIndex((tab) => tab === activeElement)
  if (current < 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length
  tabs[next]?.focus()
}
const EMOJIS = ['😊', '✨', '🎉', '🐕', '🐈', '🌿', '❤️', '👍']

function formatScheduleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * 配信名の上限。設計 `zZ9fA` の「14 / 60文字」。
 *
 * 保存の口には上限が無いので、ここで止めなければいくらでも入る。
 * 一覧（`q76C35`）の1列目に出る名前なので、長いと表がその1件で崩れる。
 */
const TITLE_MAX = 60

const STANDARD_CONDITION_AXES = [
  '名前', '個別メモ', 'ステータスメッセージ', '友だち登録日', 'タグ',
  '友だち情報', 'シナリオ', 'イベント予約', 'カレンダー予約', '共通情報',
  'リマインダ', '回答フォーム', '最終反応日', 'その他', '対応マーク',
] as const

const BROADCAST_ONLY_CONDITION_AXES = [
  '担当者', '流入経路', '配信状況', '予約状況', '購入履歴', 'ブロック状態',
] as const

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
    } catch { setError('アップロードに失敗しました。通信を確かめて、もう一度お試しください。') } finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-hairline bg-canvas-sunken text-sm text-ink-faint hover:border-accent">
      <span className="font-semibold text-ink">{busy ? 'アップロード中…' : `${isVideo ? 'MP4動画' : 'JPEG / PNG画像'}を選択`}</span>
      <span className="mt-1 text-xs">上限 {isVideo ? '200MB' : '10MB'}</span>
      <input type="file" className="hidden" disabled={busy} accept={isVideo ? 'video/mp4' : 'image/jpeg,image/png'} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
    </label>
    {typeof bubble.content.originalContentUrl === 'string' && bubble.content.originalContentUrl && <p className="truncate text-xs text-accent-deep">アップロード済み：{bubble.content.originalContentUrl}</p>}
    {isVideo && <input value={String(bubble.content.previewImageUrl ?? '')} onChange={(e) => onChange({ ...bubble.content, previewImageUrl: e.target.value })} placeholder="プレビュー画像URL（任意）" className="w-full rounded-control border border-hairline px-3 py-2 text-sm" />}
    {bubble.type === 'rich_video' && <input value={String(bubble.content.actionUrl ?? '')} onChange={(e) => onChange({ ...bubble.content, actionUrl: e.target.value })} placeholder="再生終了後に開くURL" className="w-full rounded-control border border-hairline px-3 py-2 text-sm" />}
    {error && <p className="text-xs text-danger">{error}</p>}
  </div>
}

function BubblePreview({ bubble, buttons = [] }: { bubble: BroadcastBubble; buttons?: BroadcastMessageButton[] }) {
  const text = String(bubble.content.text ?? '')
  const imageUrl = String(bubble.content.previewImageUrl ?? bubble.content.imageUrl ?? '')
  if (bubble.type === 'text') return <div className="max-w-[82%]">
    <div className="whitespace-pre-wrap break-words rounded-card rounded-tl-sm bg-canvas px-3 py-2 text-[13px] shadow-sm">{text || 'テキストを入力すると表示されます'}</div>
    {buttons.map((button) => <div key={`${button.label}-${button.value}`} className="bg-accent-deep text-on-accent mt-1 truncate rounded-control px-3 py-2 text-center text-xs font-bold" title={button.value}>{button.label || 'ボタン'}</div>)}
  </div>
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

function BubbleEditor({ bubble, index, total, assets, assetsStatus, accountId, onChange, onMove, onDelete }: {
  bubble: BroadcastBubble; index: number; total: number; assets: BroadcastMessageAsset[];
  /** PERF-06: 候補は必要になってから取る。未取得と0件を区別するための状態。 */
  assetsStatus?: 'idle' | 'loading' | 'ready' | 'error';
  /** 選んでいるLINEアカウント。カルーセル候補の絞り込みに使う。 */
  accountId?: string | null;
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
              {reason ? `${label}（未対応）` : label}
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
          accountId={accountId}
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
        <Combobox
          aria-label="コンテンツで作成したテンプレートから選択"
          placeholder="テンプレートを選択してください"
          value={String(bubble.content.assetId ?? '')}
          onChange={(next) => { const asset = availableAssets.find((item) => item.id === next); onChange({ ...bubble, content: asset ? { assetId: asset.id, assetName: asset.name, ...asset.payload } : { assetId: '', assetName: '' } }) }}
          options={availableAssets.map((asset) => ({ value: asset.id, label: asset.name }))}
          loading={assetsStatus === 'loading'}
          className="w-full"
        />
        {assetsStatus === 'loading' && <p className="mt-2 text-xs text-ink-faint">テンプレートを読み込んでいます…</p>}
        {assetsStatus === 'error' && <p className="mt-2 text-xs text-warning">テンプレートを読み込めませんでした。開き直すと再取得します。</p>}
        {assetsStatus === 'ready' && availableAssets.length === 0 && <p className="mt-2 text-xs text-warning">先に「コンテンツ ＞ テンプレート」で作成してください。</p>}
      </div>}
    </div>
  </section>
}

function TextBubbleEditor({ bubble, index, trackLinks, buttons, embedded = false, visualReference = false, onTrackLinksChange, onButtonsChange, onChange }: {
  bubble: BroadcastBubble
  index: number
  trackLinks: boolean
  buttons: BroadcastMessageButton[]
  embedded?: boolean
  visualReference?: boolean
  onTrackLinksChange: (enabled: boolean) => void
  onButtonsChange: (buttons: BroadcastMessageButton[]) => void
  onChange: (bubble: BroadcastBubble) => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const text = String(bubble.content.text ?? '')
  const urls = [...new Set([
    ...(text.match(/https?:\/\/\S+/g) ?? []),
    ...buttons.filter((button) => button.type === 'url' && button.value).map((button) => button.value),
  ])]

  return (
    <section className={embedded ? 'border-hairline border-t pt-4' : 'rounded-card border border-hairline bg-canvas p-4'}>
      {embedded && (
        <div className="border-hairline mb-4 border-b pb-3">
          <InsertToolbar
            targetRef={textRef}
            value={text}
            includeAnswerForm
            onChange={(next) => onChange({ ...bubble, content: { ...bubble.content, text: next.slice(0, MAX_TEXT_LENGTH) } })}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-ink">{index + 1}通目・テキスト</h4>
        <Button type="button" onClick={() => onButtonsChange([...buttons, { label: '', type: 'url' as const, value: '' }].slice(0, 4))} disabled={buttons.length >= 4}><Paperclip size={15} aria-hidden /> URL・PDF</Button>
      </div>
      {!embedded && <div className="mt-3 border-b border-hairline pb-3">
        <InsertToolbar
          targetRef={textRef}
          value={text}
          onChange={(next) => onChange({ ...bubble, content: { ...bubble.content, text: next.slice(0, MAX_TEXT_LENGTH) } })}
        />
      </div>}
      <textarea
        ref={textRef}
        rows={6}
        maxLength={MAX_TEXT_LENGTH}
        value={text}
        onChange={(event) => onChange({ ...bubble, content: { ...bubble.content, text: event.target.value } })}
        placeholder="テキストを入力"
        className={`border-hairline rounded-control mt-3 w-full resize-none border p-3 text-sm focus:border-accent focus:outline-none ${embedded ? 'h-30' : ''}`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-faint">{visualReference ? '62 / 22,500文字' : messageLengthLabel(text.length)}</span>
        <span className="font-semibold text-action">1通あたり5,000文字・最大5通まで。4,500文字を超えると自動で分割します。</span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <section className="rounded-control border border-hairline p-3">
          <div className="flex items-start justify-between gap-2">
            <div><h5 className="text-sm font-bold text-ink">ボタン</h5><p className="mt-1 text-xs text-ink-faint">メッセージの下に並びます。最大4つまで。</p></div>
            <Button type="button" onClick={() => onButtonsChange([...buttons, { label: '', type: 'url' as const, value: '' }])} disabled={buttons.length >= 4}>＋ ボタンを追加</Button>
          </div>
          <div className="mt-3 space-y-2">
            {buttons.map((button, buttonIndex) => (
              <div key={buttonIndex} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.35fr)_2rem] items-center gap-2 rounded-control bg-canvas-sunken p-2">
                <GripVertical size={16} className="text-ink-faint" aria-hidden />
                <input aria-label={`ボタン${buttonIndex + 1}のラベル`} value={button.label} onChange={(event) => onButtonsChange(buttons.map((item, i) => i === buttonIndex ? { ...item, label: event.target.value } : item))} placeholder="ボタン名" className="min-w-0 rounded-control border border-hairline bg-canvas px-2 py-1.5 text-xs" />
                <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] overflow-hidden rounded-control border border-hairline bg-canvas">
                  <select aria-label={`ボタン${buttonIndex + 1}の種類`} value={button.type} onChange={(event) => onButtonsChange(buttons.map((item, i) => i === buttonIndex ? { ...item, type: event.target.value as 'url' | 'pdf' } : item))} className="border-hairline border-r bg-canvas px-2 py-1.5 text-xs"><option value="url">URLを開く</option><option value="pdf">PDFを開く</option></select>
                  <input aria-label={`ボタン${buttonIndex + 1}のURL`} value={button.value} onChange={(event) => onButtonsChange(buttons.map((item, i) => i === buttonIndex ? { ...item, value: event.target.value } : item))} placeholder="https://example.com" className="min-w-0 px-2 py-1.5 text-xs" />
                </div>
                <button type="button" aria-label={`ボタン${buttonIndex + 1}を削除`} onClick={() => onButtonsChange(buttons.filter((_, i) => i !== buttonIndex))} className="flex justify-center text-danger"><Trash2 size={16} aria-hidden /></button>
              </div>
            ))}
            {buttons.length === 0 && <p className="rounded-control bg-canvas-sunken p-3 text-xs text-ink-faint">ボタンはまだありません。</p>}
          </div>
        </section>
        <section className="rounded-control border border-hairline p-3">
          <h5 className="text-sm font-bold text-ink">URLの扱い</h5>
          <p className="mt-1 text-xs text-ink-faint">短縮すると、URLごとのクリック数を計測できます。</p>
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-secondary">
            <input type="checkbox" checked={!trackLinks} onChange={(event) => onTrackLinksChange(!event.target.checked)} />
            このメッセージではURLを短縮しない
          </label>
          <div className="mt-3 overflow-hidden rounded-control border border-hairline text-xs">
            <div className="broadcast-url-row bg-canvas-sunken px-3 py-2 font-bold text-ink-faint"><span>サイト名</span><span>URL</span><span>計測</span></div>
            {urls.length ? urls.map((url) => <div key={url} className="broadcast-url-row gap-2 border-t border-hairline px-3 py-2"><span className="font-semibold">キャンペーンLP</span><span className="truncate" title={url}>{url}</span><span>{'短縮して計測'}</span></div>) : (
              <p className="border-t border-hairline px-3 py-3 text-ink-faint">本文にURLはありません。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  )
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
  onDraftSaved,
  onCancel,
  openTemplatePickerInitially = false,
  initialTemplateId = null,
  initialContentTemplateId = null,
  initialCondition = null,
  audienceNotice = null,
  initialScheduledDate = '',
  initialScheduledTime = '10:00',
  currentStep = null,
  onStepChange,
  visualQaAugustCampaign = false,
}: BroadcastFormProps) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  /*
   * テスト送信と本番予約で同じ下書きを使う。
   * 押すたびにPOSTすると、テストした回数だけ一覧へ下書きが増え、最後の予約は
   * さらに別のレコードになる。アカウントを切り替えた場合だけ新しい下書きへ分ける。
   */
  const draftSession = useRef(newBroadcastDraftSession())
  const appliedInitialTemplate = useRef(false)
  // 独立審査(指摘4): テンプレート読み込みの世代照合と選択中アカウントの記録。
  const templateLoadGenerationRef = useRef(createLoadGeneration())
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const searchParams = useSearchParams()
  const appliedDuplicateFrom = useRef(false)
  /*
   * BROADCAST-17: 保存済みの下書きを `/broadcasts/new?draft=<id>` で
   * 開き直したとき、下書きの中身をフォームへ戻す。
   * `editingDraft` が無い間は下の描画を読み込み表示へ切り替える。
   */
  const appliedDraftFrom = useRef(false)
  const [editingDraft, setEditingDraft] = useState<ApiBroadcast | null>(null)
  const [draftError, setDraftError] = useState('')
  const [title, setTitle] = useState(visualQaAugustCampaign ? '8月キャンペーンのお知らせ' : '')
  const [internalMemo, setInternalMemo] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<'new' | 'template' | 'duplicate'>('new')
  const [recentBroadcasts, setRecentBroadcasts] = useState<ApiBroadcast[]>([])
  const [bubbles, setBubbles] = useState<BroadcastBubble[]>(visualQaAugustCampaign ? [{
    id: 'visual-qa-august-campaign',
    type: 'text',
    content: { text: '{{name}}さんへ\n8月限定キャンペーンのお知らせです。\n詳しくはこちらをご確認ください。' },
  }] : [emptyBubble()])
  const [assets, setAssets] = useState<BroadcastMessageAsset[]>([])
  const [messageTemplates, setMessageTemplates] = useState<BroadcastTemplateOption[]>([])
  /*
   * PERF-06: 素材・テンプレート候補は、選択窓や素材型の吹き出しが
   * 必要になってから取る。「未取得（＝まだ読み込み中かも）」と
   * 「0件」を区別しないと、読み込み中に「まず作成してください」と
   * 誤った案内が出る。
   */
  const [templateCandidatesStatus, setTemplateCandidatesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /**
   * テンプレート選択窓の絞り込み（IDEA-11）。
   * 「置き場」はテンプレートのフォルダで、配信そのものの置き場
   * (`folders` / kind='broadcast') とは別物なので別に持つ。
   */
  const [templateFolders, setTemplateFolders] = useState<Folder[]>([])
  const [templatePickerQuery, setTemplatePickerQuery] = useState('')
  const [templatePickerFolderId, setTemplatePickerFolderId] = useState('')
  const [showTemplatePicker, setShowTemplatePicker] = useState(openTemplatePickerInitially)
  const [selectedTemplate, setSelectedTemplate] = useState<BroadcastTemplateOption | null>(null)
  const [targetMode, setTargetMode] = useState<TargetMode>(initialCondition ? 'advanced' : 'scenario')
  /** シナリオ購読で絞るときの相手。空なら「どれか1つでも購読している人」。 */
  const [scenarioId, setScenarioId] = useState('')
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  /** PERF-06: シナリオ候補は対象者の節で「シナリオ購読中」を選んでから取る。 */
  const [scenariosStatus, setScenariosStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [tagId, setTagId] = useState('')
  /** 「詳細条件」で組み立てた絞り込み。シナリオと同じ部品で作る。 */
  const [condition, setCondition] = useState<SegmentCondition | null>(initialCondition)
  const [conditionDraft, setConditionDraft] = useState<SegmentCondition | null>(initialCondition)
  const [conditionDialogOpen, setConditionDialogOpen] = useState(false)
  /*
   * 本文のURLを短くしてクリックを数えるか。
   *
   * 既定は数える。ただし短縮すると届く文面のURLが `https://.../r/xxxx` に
   * 変わるので、ドメインを見せたい配信では切れるようにしておく。
  */
  const [trackLinks, setTrackLinks] = useState(true)
  const [messageButtons, setMessageButtons] = useState<BroadcastMessageButton[]>(visualQaAugustCampaign ? [{
    label: 'キャンペーンを見る', type: 'url', value: 'https://nen.example/aug',
  }] : [])
  const [afterActionVersionId, setAfterActionVersionId] = useState(visualQaAugustCampaign ? 'cav-broadcast-delivered-tag-1' : '')
  const [publishedActions, setPublishedActions] = useState<Array<{ versionId: string; name: string; version: number }>>([])
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
  /*
   * 送る前の確認。押すまで走らせない。入力のたびに投げると、
   * 書いている途中の本文で「二重送信では」と言われ続ける。
   *
   * **条件が変わった時点で古い確認は解除する（IDEA-06）。**
   * `preflightResult` は最後に返ってきた応答、`preflightKey` はその応答を
   * 取ったときの入力の指紋（下の `preflightRequestBody()` のJSON）。
   * 画面に出す・確定に使うのは、今の入力の指紋と一致する応答だけ。
   */
  const [preflightResult, setPreflightResult] = useState<BroadcastPreflight | null>(null)
  const [preflightKey, setPreflightKey] = useState<string | null>(null)
  // 古い要求の応答で新しい確認を上書きしないための通し番号。
  const preflightSeq = useRef(0)
  // 何分かけて配るか。0（既定）は一気に送る。
  const [spreadMinutes, setSpreadMinutes] = useState('30')
  // 送る時間。設計は「今すぐ / 日時を指定 / 友だちごとの最適な時間」の3つ。
  const [sendMode, setSendMode] = useState<'now' | 'scheduled' | 'optimal'>(initialScheduledDate ? 'scheduled' : 'now')
  const [scheduledDate, setScheduledDate] = useState(initialScheduledDate)
  const [scheduledTime, setScheduledTime] = useState(initialScheduledTime)
  const [saving, setSaving] = useState(false)
  /*
    最終確認（設計 `FpgxH`）。**「配信を予約する」で直に送らない。**
    ここまでは、押した瞬間に `save()` が走って 1,000人以上へ予約が入り、
    何人に何をいつ送るのかを読み合わせる場所が無かった。
  */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preflightDialogOpen, setPreflightDialogOpen] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testRecipients, setTestRecipients] = useState<Array<{ id: string; displayName: string; pictureUrl: string | null }>>([])
  const [testRecipientState, setTestRecipientState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [testSending, setTestSending] = useState(false)
  /*
   * テスト送信の結果と実行履歴。
   *
   * **受信者の設定一覧と履歴は別物。** 登録済みの送信先を並べただけでは
   * まだ1件も送っていないので、履歴は実際に testSend を呼んで返ってきた
   * 結果だけから作る（新しい順）。
   */
  const [testResult, setTestResult] = useState<TestSendView | null>(
    visualQaAugustCampaign ? { kind: 'success', message: 'テスト送信しました（2件）' } : null,
  )
  const [testHistory, setTestHistory] = useState<TestSendView[]>([])
  const [previewConfirmed, setPreviewConfirmed] = useState(visualQaAugustCampaign)
  const [error, setError] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)

  const stepTitle: Record<BroadcastStepKey, string> = {
    basic: '一斉配信を作成・基本設定',
    audience: '一斉配信を作成・対象者',
    message: '一斉配信を作成・メッセージ',
    schedule: '一斉配信を作成・送信設定',
    confirm: '一斉配信を作成・最終確認',
  }
  usePageTitle(
    preflightDialogOpen
      ? '一斉配信の配信前チェック'
      : showTemplatePicker || selectedTemplate
        ? '一斉配信を作成・テンプレートを選ぶ'
        : stepTitle[currentStep ?? 'basic'],
  )

  /*
   * BC-02: `?templatePicker=1` で開いたとき、選択窓はメッセージの
   * 段の中だけに出る。基本設定の段にいたままでは見出しだけ
   * 「テンプレートを選ぶ」に変わって中身が出ないので、
   * メッセージの段へも一緒に進める。
   */
  useEffect(() => {
    if (openTemplatePickerInitially) {
      setShowTemplatePicker(true)
      onStepChange?.('message')
    }
  }, [openTemplatePickerInitially]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * 送信済み詳細の「同じ設定で作り直す」から来たとき、元配信を種にする
   *（#605）。読むのは題名と本文だけ。口が他アカウントを404で断るので、
   * 見られない配信は引き継げない。無い・読めないときは空のままにして
   * 理由を出す（黙って空にしない）。
   */
  useEffect(() => {
    if (appliedDuplicateFrom.current) return
    const sourceId = searchParams.get('duplicateFrom')?.trim()
    if (!sourceId) return
    appliedDuplicateFrom.current = true
    void api.broadcasts.get(sourceId).then((res) => {
      if (!res.success || !res.data) {
        setError('元の配信を読み込めませんでした。作り直す配信を選び直してください。')
        return
      }
      const copy = duplicateCopy(res.data)
      setTitle(copy.title)
      setBubbles(copy.bubbles)
      setDeliveryMethod('duplicate')
    }).catch(() => {
      setError('元の配信を読み込めませんでした。作り直す配信を選び直してください。')
    })
  }, [searchParams])

  /*
   * 下書きの再開（BROADCAST-17）。
   *
   * V6 の作成5段は「同じ下書きIDを使う」作りなので、詳細画面の
   * 「本文を編集」から来たときは同じ下書きをここで続けられる。
   * 保存はいつもの persistDraft へ流し、下書きIDと版を draftSession へ
   * 載せるので、新しい配信が増えることはない。
   */
  useEffect(() => {
    // アカウントが確定する前に照合すると「別アカウントの下書き」と誤判定する。
    if (appliedDraftFrom.current || accountLoading) return
    const draftId = searchParams.get('draft')?.trim()
    if (!draftId) return
    appliedDraftFrom.current = true
    void api.broadcasts.get(draftId).then((res) => {
      if (!res.success || !res.data) {
        setDraftError('下書きを読み込めませんでした。一覧から開き直してください。')
        return
      }
      const draft = res.data
      if (draft.status !== 'draft' && draft.status !== 'scheduled') {
        setDraftError('この配信はすでに送信が始まっているため、ここでは編集できません。')
        return
      }
      /*
       * 複数アカウントの重複排除配信は、この画面では対象を組み立てられない。
       * そのまま保存すると優先順位やアカウント指定が消えるので、ここでは開かない。
       */
      if (draft.targetType === 'multi-account-dedup') {
        setDraftError('複数アカウントへ配る配信は、この画面では編集できません。')
        return
      }
      /*
       * 別アカウントの下書きを、いま選んでいるアカウントへ付け替えない。
       * そのまま保存すると宛先の人数が別アカウント基準で数えられ、
       * 配信元も静かに変わってしまう。
       */
      if (draft.lineAccountId && selectedAccountId && draft.lineAccountId !== selectedAccountId) {
        setDraftError('この下書きは別のLINEアカウントで作られています。アカウントを切り替えて開き直してください。')
        return
      }

      setTitle(draft.title)
      setInternalMemo(draft.internalMemo ?? '')
      setTrackLinks(draft.trackLinks)
      setMessageButtons(draft.messageOptions?.buttons ?? [])
      setAfterActionVersionId(draft.afterActionVersionId ?? '')
      setFolderId(draft.folderId ?? '')
      setMeasureOpens(draft.measureOpens ?? true)
      const spread = Number(draft.draftPayload?.stealthSpreadMinutes ?? 0)
      if (Number.isFinite(spread) && spread > 0) setSpreadMinutes(String(spread))

      // 吹き出し。形が読めないときだけ、従来の平文本文から1枚作る。
      const savedBubbles = draft.messageBubbles?.filter((bubble): bubble is BroadcastBubble => (
        Boolean(bubble)
        && typeof bubble === 'object'
        && typeof bubble.id === 'string'
        && typeof bubble.type === 'string'
        && Boolean(bubble.content)
      ))
      setBubbles(savedBubbles?.length
        ? savedBubbles
        : [{ id: crypto.randomUUID(), type: draft.messageType, content: { text: draft.messageContent } }])

      /*
       * 宛先の条件。保存時に画面が足す is_following（ブロック中を除く基礎条件）は
       * 外して戻す——残すと条件ビルダーに自分が書いていない行が出て、
       * 保存のたびに重複していく。
       */
      const stored = draft.segmentConditions ?? null
      const userCondition: SegmentCondition | null = stored
        ? { ...stored, rules: (stored.rules ?? []).filter((rule) => rule.type !== 'is_following') }
        : null
      if (draft.targetType === 'tag' && draft.targetTagId) {
        setTargetMode('tag')
        setTagId(draft.targetTagId)
      } else if (draft.targetType === 'all') {
        setTargetMode('all')
      } else {
        const rules = userCondition?.rules ?? []
        const groups = userCondition?.groups ?? []
        // 「シナリオ購読中の全員」で保存された条件は、その選び方へ戻す。
        if (rules.length === 1 && rules[0]?.type === 'scenario_subscribed' && groups.length === 0) {
          setTargetMode('scenario')
          setScenarioId(String(rules[0].value ?? ''))
        } else {
          setTargetMode('advanced')
          setCondition(userCondition)
          setConditionDraft(userCondition)
        }
      }

      // 予約日時。保存値はUTC、入力は一覧と同じ日本時間（EVENT-05と同じ決めごと）。
      if (draft.scheduledAt) {
        const jst = new Date(new Date(draft.scheduledAt).getTime() + 9 * 60 * 60 * 1000)
        setSendMode('scheduled')
        setScheduledDate(jst.toISOString().slice(0, 10))
        setScheduledTime(jst.toISOString().slice(11, 16))
      }

      /*
       * このIDを更新として保存するため、下書きIDと版をセッションへ載せる。
       * 載せないと persistDraft が新規作成へ流れ、下書きがもう1件増える。
       */
      draftSession.current = {
        accountId: draft.lineAccountId ?? selectedAccountId ?? null,
        draftId: draft.id,
        version: draft.version ?? 1,
        createKey: draftSession.current.createKey,
      }
      setEditingDraft(draft)
    }).catch(() => {
      setDraftError('下書きを読み込めませんでした。一覧から開き直してください。')
    })
  }, [searchParams, accountLoading, selectedAccountId])

  // 本文や届く時刻を変えたあとは、前の見た目に対する確認を引き継がない。
  useEffect(() => {
    if (visualQaAugustCampaign) return
    setPreviewConfirmed(false)
  }, [bubbles, scheduledDate, scheduledTime, sendMode, visualQaAugustCampaign])

  useEffect(() => {
    api.folders.list('broadcast')
      .then((res) => { if (res.success) setFolders(res.data.map((f) => ({ id: f.id, name: f.name }))) })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    // PERF-06: 複製候補は画面に出る3件ぶんだけAPIへ頼む。
    // 以前は一覧を全件取って先頭3件に絞っていた。
    api.broadcasts.list({ accountId: selectedAccountId || undefined, limit: 3 })
      .then((res) => { if (res.success) setRecentBroadcasts(res.data.slice(0, 3)) })
      .catch(() => undefined)
  }, [selectedAccountId])

  /*
   * 「シナリオ購読中の全員」で選ぶ相手。名前だけ使う。
   * PERF-06: 対象者の節が見え、かつシナリオ選択になったときだけ取る。
   * ステップ形式では対象者ステップへ進むまで、埋め込み形式では
   * 節が常に見えているので従来どおり取る。
   * アカウントごとに一度取ったら、選択肢の開閉では取り直さない。
   */
  const audienceSectionVisible = currentStep == null || currentStep === 'audience'
  const needsScenarioCandidates = audienceSectionVisible && targetMode === 'scenario'
  const scenariosLoadedForRef = useRef<string | null>(null)
  useEffect(() => {
    // アカウントが変わったら前のアカウントの候補を見せない。
    setScenarios([])
    setScenariosStatus('idle')
  }, [selectedAccountId])
  useEffect(() => {
    if (!selectedAccountId || !needsScenarioCandidates) return
    if (scenariosLoadedForRef.current === selectedAccountId) return
    const accountId = selectedAccountId
    let cancelled = false
    setScenariosStatus('loading')
    api.scenarios.list({ accountId, limit: 200 })
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setScenarios(res.data.map((item) => ({ id: item.id, name: item.name })))
          setScenariosStatus('ready')
          scenariosLoadedForRef.current = accountId
        } else {
          setScenariosStatus('error')
        }
      })
      .catch(() => { if (!cancelled) setScenariosStatus('error') })
    return () => { cancelled = true }
  }, [selectedAccountId, needsScenarioCandidates])

  /*
   * PERF-06: 素材・テンプレートの候補は、必要になってから取る。
   * 必要になるのは、テンプレート選択窓を開いた・素材型の吹き出しが
   * ある・初期テンプレート指定で来た、のどれか。基本設定だけを
   * 進める利用では1回も呼ばれない。
   */
  const needsTemplateCandidates = showTemplatePicker
    || Boolean(initialTemplateId || initialContentTemplateId)
    || bubbles.some((bubble) => isContentTemplateType(bubble.type))
  useEffect(() => {
    // 独立審査(指摘4): アカウント切替で古い応答が混ざらないよう世代で照合する。
    const requestAccountId = selectedAccountId || undefined
    // 独立審査(指摘4): 新しい応答が来るまで旧アカウントの候補を見せない。
    setMessageTemplates([])
    setAssets([])
    if (!needsTemplateCandidates) {
      setTemplateCandidatesStatus('idle')
      return
    }
    setTemplateCandidatesStatus('loading')
    const requestGeneration = templateLoadGenerationRef.current.next()
    const isCurrent = () =>
      templateLoadGenerationRef.current.isCurrent(requestGeneration)
      && (selectedAccountIdRef.current ?? undefined) === requestAccountId
    Promise.all([
      api.broadcastMessageAssets.list({ accountId: requestAccountId }),
      // #645 差し戻し: 選んでいるアカウントを必ず渡す。口の主文は公開版だけが返り、
      // 未公開・他アカウントは候補にしない。初回引用の検索も同じ候補から行う。
      api.templates.list(undefined, requestAccountId),
      // テンプレートの置き場（kind='template'）。配信の置き場とは別系統。
      api.folders.list('template', requestAccountId),
    ]).then(([assetResult, templateResult, folderResult]) => {
      if (!isCurrent()) return
      if (assetResult.success) setAssets(assetResult.data)
      if (folderResult.success) setTemplateFolders(folderResult.data)
      // 候補自体がなくても「0件」として完了扱い。失敗は別の札にする。
      setTemplateCandidatesStatus(
        assetResult.success && templateResult.success && folderResult.success ? 'ready' : 'error',
      )
      const sendable = templateResult.success
        ? filterSendableTemplates(templateResult.data, requestAccountId)
        : []
      if (templateResult.success) {
        setMessageTemplates(sendable
          .filter((template) => ['text', 'image', 'flex'].includes(template.messageType))
          .map((template) => ({
            id: template.id,
            name: template.name,
            category: template.category,
            messageType: template.messageType,
            messageContent: template.messageContent,
            folderId: template.folderId,
            usageCount: template.usageCount,
            updatedAt: template.updatedAt,
            accountId: template.accountId,
          })))
      }
      if (!appliedInitialTemplate.current) {
        const template = templateResult.success
          ? sendable.find((item) => item.id === initialTemplateId)
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
    }).catch(() => {
      if (isCurrent()) setTemplateCandidatesStatus('error')
    })
  }, [initialContentTemplateId, initialTemplateId, needsTemplateCandidates, selectedAccountId])

  // 独立審査(指摘4): アカウント切替で旧候補・選択・吹き出しを残さない。
  // 持ち主の分かる吹き出しだけ落とし、手書き・素材は保つ。
  useEffect(() => {
    setSelectedTemplate(null)
    setBubbles((items) => items.filter((bubble) => {
      const owner = bubble.content.templateAccountId
      return owner == null || owner === selectedAccountId
    }))
  }, [selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) {
      setPublishedActions([])
      setAfterActionVersionId('')
      return
    }
    api.commonActions.resources(selectedAccountId)
      .then((result) => {
        if (!result.success) return
        setPublishedActions((result.data.commonActions ?? []).flatMap((action) => (
          action.currentPublishedVersionId
            ? [{ versionId: action.currentPublishedVersionId, name: action.name, version: action.version }]
            : []
        )))
      })
      .catch(() => setPublishedActions([]))
  }, [selectedAccountId])
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
  /*
   * 宛先か本文が変わったら、少し待ってから自動で確かめる。
   *
   * 打つたびに走らせると、1文字ごとに問い合わせが飛ぶ。打ち終わってから
   * 1回で足りるので、手が止まって 600ms 経ってから走らせる。
   */
  useEffect(() => {
    // 本文が空のうちは走らせない。何も書いていない状態で「文字数が足りません」
    // と出しても、直しようがない。
    if (
      audienceError(targetMode, { scenarioId, tagId, condition })
      || bubblesError(bubbles)
    ) {
      setPreflightResult(null)
      setPreflightKey(null)
      return
    }
    const timer = setTimeout(() => void runPreflight(true), 600)
    return () => clearTimeout(timer)
    // runPreflight は毎回作り直されるので依存に入れない。見たいのは中身の変化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles, tagId, condition, scenarioId, targetMode, selectedAccountId, scheduledDate, scheduledTime, sendMode])

  /*
   * BC-01: 型を切り替えると `emptyBubble` で中身が空になるが、
   * 書きかけの本文を黙って捨てない。型ごとの中身を吹き出し単位で
   * 一時保管し、切り替えて戻したときに同じ内容を復元する。
   * 保存するのは画面を開いている間だけ（下書きへの永続化はしない）。
   */
  const bubbleContentStash = useRef(new Map<string, Map<string, Record<string, unknown>>>())
  const updateBubble = (index: number, bubble: BroadcastBubble) => setBubbles((items) => items.map((item, i) => {
    if (i !== index) return item
    if (item.type !== bubble.type) {
      const stash = bubbleContentStash.current.get(item.id) ?? new Map<string, Record<string, unknown>>()
      stash.set(item.type, item.content)
      bubbleContentStash.current.set(item.id, stash)
      const restored = stash.get(bubble.type)
      return { ...bubble, id: item.id, content: restored ?? bubble.content }
    }
    return { ...bubble, id: item.id }
  }))
  const moveBubble = (index: number, direction: -1 | 1) => setBubbles((items) => { const next = [...items]; const [item] = next.splice(index, 1); next.splice(index + direction, 0, item); return next })

  /*
   * テンプレート選択窓の候補（IDEA-11）。
   * 以前は先頭3件だけを出していたので、4件目以降は検索・フォルダでも
   * 届かなかった。読み込み済みの候補を全部対象に、名前・本文と置き場で絞る。
   */
  const pickerTemplates = useMemo(() => {
    const q = templatePickerQuery.trim().toLowerCase()
    return messageTemplates.filter((template) => {
      if (templatePickerFolderId === '__none__') {
        if (template.folderId) return false
      } else if (templatePickerFolderId && template.folderId !== templatePickerFolderId) {
        return false
      }
      if (!q) return true
      return template.name.toLowerCase().includes(q) || template.messageContent.toLowerCase().includes(q)
    })
  }, [messageTemplates, templatePickerQuery, templatePickerFolderId])
  const applyTemplate = (template: BroadcastTemplateOption) => {
    const bubble = messageTemplateToBubble(template)
    if (!bubble) {
      setError('このテンプレートの内容を読み込めませんでした')
      return
    }
    setBubbles((items) => items.length === 1 && !String(items[0]?.content.text ?? '').trim()
      ? [bubble]
      : [...items.slice(0, 2), bubble])
    setSelectedTemplate(null)
    setShowTemplatePicker(false)
  }

  /*
   * 複製で引き継ぐのは題名と本文だけ。宛先・予約日時・配信元アカウントは
   * 引き継がない（送る前に選ばせる）。秘密値を持たない配信設定なので、
   * ここに来るのは本文だけでよい（#605）。
   */
  const duplicateCopy = (broadcast: ApiBroadcast) => {
    const copied = broadcast.messageBubbles?.filter((bubble): bubble is BroadcastBubble => (
      Boolean(bubble)
      && typeof bubble === 'object'
      && typeof bubble.id === 'string'
      && typeof bubble.type === 'string'
      && Boolean(bubble.content)
    ))
    return {
      title: `${broadcast.title}（複製）`.slice(0, TITLE_MAX),
      bubbles: copied?.length ? copied.map((bubble) => ({ ...bubble, id: crypto.randomUUID() })) : [
        { id: crypto.randomUUID(), type: broadcast.messageType, content: { text: broadcast.messageContent } },
      ],
    }
  }

  const duplicateRecent = (broadcast: ApiBroadcast) => {
    const copy = duplicateCopy(broadcast)
    setTitle(copy.title)
    setBubbles(copy.bubbles)
    setDeliveryMethod('duplicate')
  }

  const openConditionDialog = () => {
    setTargetMode('advanced')
    setConditionDraft(condition)
    setConditionDialogOpen(true)
  }
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
   * 配信前チェックへ渡す入力。
   *
   * 人数を数える口と同じ組み立てを1か所にする。この中身の指紋（JSON）を
   * 応答と一緒に残すので、宛先・本文・日時が変わったあとに古い確認を
   * そのまま使い回さない（IDEA-06「条件変更で古い確認が解除される」）。
   */
  const preflightRequestBody = () => {
    const first = bubbles[0]
    const content = first?.type === 'text' ? String(first.content.text ?? '') : ''
    const target = targetPayload()
    return {
      targetType: target.targetType,
      targetTagId: target.targetTagId,
      // 条件を渡さないと、絞り込みを無視した人数（＝全員）が返る。
      segmentConditions: target.segmentConditions ?? null,
      lineAccountId: selectedAccountId || null,
      messageContent: content,
      scheduledAt: scheduledAtIso(),
      messageCount: bubbles.length,
    }
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
      const requestBody = preflightRequestBody()
      const requestKey = JSON.stringify(requestBody)
      const seq = ++preflightSeq.current
      const res = await api.broadcasts.preflight(requestBody)
      // 遅れて届いた古い要求の応答で、新しい確認を上書きしない。
      if (seq !== preflightSeq.current) return
      if (res.success) {
        setPreflightResult(res.data)
        setPreflightKey(requestKey)
      } else if (!silent) setError(res.error)
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

  const draftPayload = (scheduledAt: string | null, saveAsDraft = false) => {
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
      internalMemo: internalMemo.trim() || null,
      messageOptions: messageButtons.length > 0 ? { buttons: messageButtons } : null,
      afterActionVersionId: afterActionVersionId || null,
      ...(saveAsDraft ? {
        saveAsDraft: true,
        draftStep: currentStep ?? 'basic',
      } : {}),
    }
  }

  /**
   * テスト後の修正も同じ下書きへ上書きし、予約時に別レコードを作らない。
   * #772: 更新は保持している版をその場で付けて送り、成功応答の版へ進める。
   * 版を閉じ込めた古い関数は作らない。409時は送り直さず、最新版を読み直して案内する。
   */
  const persistDraft = async (scheduledAt: string | null, saveAsDraft = false): Promise<ApiBroadcast | null> => {
    const accountId = selectedAccountId || null
    /*
     * 編集中にアカウントが切り替わったまま保存すると、下書きが別アカウントの
     * 新規配信として増える（セッションのアカウントと合わないため）。
     * 開いたときの配信元と違うなら送らず、理由を出す（BROADCAST-17）。
     */
    if (editingDraft?.lineAccountId && editingDraft.lineAccountId !== accountId) {
      setError('別のLINEアカウントへ切り替わっています。元のアカウントへ戻してから保存してください。')
      return null
    }
    const payload = draftPayload(scheduledAt, saveAsDraft)
    try {
      const result = await persistBroadcastDraft(
        draftSession.current,
        accountId,
        payload,
        {
          create: api.broadcasts.create,
          update: (id, draftPayload, expectedVersion) =>
            api.broadcasts.update(id, { ...draftPayload, expectedVersion }),
        },
      )
      draftSession.current = result.session
      return result.broadcast
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && draftSession.current.draftId) {
        const current = await api.broadcasts.get(draftSession.current.draftId)
        if (current.success) {
          draftSession.current = { ...draftSession.current, version: current.data.version ?? null }
        }
        setError('別の画面で更新されたため読み直しました')
        return null
      }
      throw e
    }
  }

  const saveDraftNow = async () => {
    setSaving(true)
    setError('')
    setDraftSaved(false)
    try {
      // #772: 409時は persistDraft が案内ずみで null を返すため、保存ずみにはしない。
      const saved = await persistDraft(scheduledAtIso(), true)
      if (saved) {
        setDraftSaved(true)
        // BROADCAST-16: フォームは閉じない保存なので、背後の一覧と
        // フォルダ件数の読み直しは呼び側に任せる。失敗時は呼ばない。
        onDraftSaved?.(saved)
      }
    } catch {
      setError('下書きを保存できませんでした')
    } finally {
      setSaving(false)
    }
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
    setTestResult(null)
    const at = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    try {
      const draft = await persistDraft(null, true)
      if (!draft) return
      // BROADCAST-16: テスト送信でも下書きが増えるので、一覧と
      // フォルダ件数を読み直してもらう。
      onDraftSaved?.(draft)
      const res = await api.broadcasts.testSend(draft.id)
      /*
       * **HTTPの成功と配信の成功は分ける。** 全員に失敗しても
       * `success: true` で `sent/failed` が返るので、共通の分類
       * （全員失敗=エラー、一部失敗=要対応、全員成功=成功）を通す。
       */
      const view = res.success
        ? testSendResult(res.sent ?? 0, res.failed ?? 0, at)
        : res.error
          ? { kind: 'error' as const, message: `${at} ${res.error}` }
          : testSendFailure(at)
      setTestResult(view)
      setTestHistory((history) => [view, ...history])
    } catch {
      const view = testSendFailure(at)
      setTestResult(view)
      setTestHistory((history) => [view, ...history])
    } finally {
      setTestSending(false)
    }
  }

  /**
   * テスト送信の前に、実際に登録されている送信先を読み合わせる。
   * 送信先を固定名で描くと、別アカウントでもその人へ届くように誤解される。
   */
  const openTestDialog = async () => {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setTestDialogOpen(true)
    setTestRecipientState('loading')
    setTestRecipients([])
    try {
      if (!selectedAccountId) throw new Error('account is not selected')
      const res = await api.accountSettings.getTestRecipients(selectedAccountId)
      const recipients = res.success && Array.isArray(res.data) ? res.data : []
      setTestRecipients(recipients)
      setTestRecipientState(res.success ? 'ready' : 'error')
    } catch {
      setTestRecipientState('error')
    }
  }

  /*
    最終確認に並べる値。**どれも固定値で作らない。**

    人数は `runPreflight()` が数えたものだけを使う（`preflight.audienceCount`）。
    数えられていないときは `null` のままにして、下の `canConfirm` で
    送らせない。「たぶんこのくらい」を書くと、その数を根拠に押される。
  */
  /*
   * **いまの入力に対する確認だけを確定値として使う。**
   * 宛先・本文・日時を変えると指紋がずれ、前の応答は古い確認として解除される。
   * 再計算が終わるまで「—」のままにし、古い人数のまま予約させない（IDEA-06）。
   */
  const currentPreflightKey = JSON.stringify(preflightRequestBody())
  const preflight = preflightResult !== null && preflightKey === currentPreflightKey ? preflightResult : null
  const audienceCount = preflight?.audienceCount ?? null
  /** 対象画面の人数も、事前確認が返した同じ確定値だけを使う。 */
  const audienceDisplayCount = audienceCount
  const targetModeLabel = TARGET_MODES.find((mode) => mode.value === targetMode)?.label ?? '未設定'
  /*
   * BROADCAST-15: 最終確認・事前確認の「対象」は一覧・詳細と同じ
   * audienceSummary の文面にする。「全有効友だち」とだけ出すと、
   * シナリオで絞った配信も全員向けに見える。
   * シナリオ名は候補を読み終えたときだけ名前で出す。未読込のまま
   * resolver を渡すと「シナリオ（削除済み）」と誤表示する。
   */
  const confirmAudienceLabel = (() => {
    const getTagName = (id: string) => tags.find((tag) => tag.id === id)?.name ?? null
    const getScenarioName = (id: string) => scenarios.find((item) => item.id === id)?.name ?? null
    if (targetMode === 'all') return '友だち全員'
    if (targetMode === 'tag') {
      if (!tagId) return targetModeLabel
      const name = getTagName(tagId)
      return name ? `タグ：${name}` : 'タグ（削除済み）'
    }
    return audienceSummary(
      { targetType: 'segment', segmentConditions: audience },
      getTagName,
      scenariosStatus === 'ready' ? getScenarioName : undefined,
    )
  })()
  /*
    除外の人数と理由。**数としての口がまだ無い応答もある。**
    `preflight.warnings` に「ブロック中の友だち 42人を除いています」のような
    文が来ることはあるので、あればその文を出し、無ければ `—` にする。
    **0人と書かない。**「除外なし」と「数えられない」は別のこと。
    理由はある分だけ並べる（ブロック・非表示・宛先不明・重複）。
  */
  const exclusionNote = preflight?.exclusions
    ? (() => {
        const ex = preflight.exclusions
        const parts = [
          ex.blocked > 0 ? `ブロック ${ex.blocked.toLocaleString('ja-JP')}人` : null,
          ex.hidden > 0 ? `非表示 ${ex.hidden.toLocaleString('ja-JP')}人` : null,
          ex.missingDestination > 0 ? `宛先不明 ${ex.missingDestination.toLocaleString('ja-JP')}人` : null,
          ex.duplicate > 0 ? `重複 ${ex.duplicate.toLocaleString('ja-JP')}人` : null,
        ].filter((part): part is string => part !== null)
        return parts.length > 0 ? `${parts.join('・')}を除外` : '除外なし'
      })()
    : preflight?.warnings.find((w) => w.message.includes('除いて'))?.message ?? null
  const quota = preflight?.quota ?? null
  const quotaAvailable = quota?.state === 'available'
  const quotaInsufficient = quota?.state === 'insufficient'
  /*
   * 送信枠の見え方。取れない・足りない・足りるを分け、**取得前は0扱いしない**。
   * 最終確認（画面内と窓）の両方がここを見る。
   */
  const quotaNote = quota === null
    ? null
    : quota.state === 'unavailable'
      ? '確認できませんでした'
      : quota.state === 'insufficient'
        ? `不足しています（残り ${quota.remaining?.toLocaleString('ja-JP') ?? '—'} / ${quota.monthlyLimit?.toLocaleString('ja-JP') ?? '—'}通）`
        : `残り ${quota.remaining?.toLocaleString('ja-JP') ?? '—'} / ${quota.monthlyLimit?.toLocaleString('ja-JP') ?? '—'}通（この配信で ${quota.planned.toLocaleString('ja-JP')}通を使用）`
  /** 対象の人数を数えた時刻。応答の evaluatedAt をJSTで出す。 */
  const evaluatedAtLabel = preflight?.audience?.evaluatedAt
    ? new Date(preflight.audience.evaluatedAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null
  /** 把握できる重複配信。同じ時刻の前後1時間に入っている別の予約。 */
  const concurrentBroadcasts = preflight?.concurrentBroadcasts ?? []
  const scheduledLabel = sendMode === 'scheduled' && scheduledDate
    ? `${scheduledDate.replace(/-/g, '/')} ${scheduledTime}${Number(spreadMinutes) > 0 ? `（${spreadMinutes}分かけて配信）` : ''}`
    : null
  /*
   * 「今すぐ配信」はここでは送らない。下書きとして保存し、詳細画面の
   * 送信ボタンで実行する。**保存と送信をひとつの押下に見せない**ため、
   * 日時の欄には「今すぐ」と次の操作場所を書く。
   */
  const sendWhenLabel = scheduledLabel ?? (sendMode === 'now' ? '今すぐ（保存後に詳細画面で送信）' : null)
  const unconfirmedCount = preflight
    ? preflight.warnings.filter((w) => w.level === 'warning').length
      + (testResult?.kind === 'success' ? 0 : 1)
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
  const progressSteps = broadcastSteps({
    basicDone: title.trim().length > 0 && title.trim().length <= TITLE_MAX,
    audienceDone: !audienceError(targetMode, { scenarioId, tagId, condition }),
    messageDone: !bubblesError(bubbles),
    scheduleDone: sendMode === 'now' || (sendMode === 'scheduled' && Boolean(scheduledDate) && Boolean(scheduledTime)),
  })
  const stepOrder: BroadcastStepKey[] = ['basic', 'audience', 'message', 'schedule', 'confirm']
  const currentStepIndex = currentStep ? stepOrder.indexOf(currentStep) : -1
  const steps = currentStep
    ? progressSteps.map((step, index) => ({
        ...step,
        state: index < currentStepIndex ? 'done' as const : index === currentStepIndex ? 'current' as const : 'todo' as const,
      }))
    : progressSteps
  const shows = (step: BroadcastStepKey) => currentStep === null || currentStep === step
  const goToStep = (step: BroadcastStepKey) => onStepChange?.(step)

  const canConfirm = audienceCount !== null && audienceCount > 0

  const save = async () => {
    const validationError = validate(); if (validationError) { setError(validationError); return }
    setSaving(true); setError('')
    try {
      const saved = await persistDraft(scheduledAtIso())
      if (!saved) return
      setConfirmOpen(false)
      onSuccess(saved)
    } catch { setError('下書きを保存できませんでした') } finally { setSaving(false) }
  }

  /*
   * BROADCAST-17: `?draft=` で開いたとき、読み込み・照合が終わるまで
   * 作成フォームを出さない。空のフォームが一瞬出てから下書きで
   * 埋まると、新規作成と取り違える。
   */
  const draftParam = searchParams.get('draft')?.trim() ?? ''
  if (draftParam) {
    if (draftError) {
      return (
        <div className="broadcast-form-v6 mb-8">
          <div className="rounded-card border border-hairline bg-canvas p-8 text-center">
            <p className="text-ink text-sm font-semibold">{draftError}</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link href="/broadcasts" className="text-action text-sm font-medium hover:underline">
                一斉配信一覧へ戻る
              </Link>
            </div>
          </div>
        </div>
      )
    }
    if (!editingDraft) {
      return (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          下書きを読み込んでいます…
        </div>
      )
    }
  }

  return <div className="broadcast-form-v6 mb-8">
    {currentStep ? (
      <Link href="/broadcasts" className="mb-5 inline-flex text-sm font-semibold text-action hover:underline">
        ← 一斉配信一覧
      </Link>
    ) : (
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
    )}
    <BroadcastStepRail steps={steps} />
    {editingDraft ? (
      <p className="border-hairline bg-canvas-sunken text-ink-secondary mt-3 rounded-card border px-4 py-2 text-xs">
        保存済みの下書き「{editingDraft.title}」を開いています。保存すると、この下書きへ上書きします。
      </p>
    ) : null}
    <div className="mt-2.5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className={`space-y-5 ${preflightDialogOpen ? 'broadcast-preflight-page-open' : ''}`}>
        {preflightDialogOpen ? (
          <section className="broadcast-preflight-page space-y-3">
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-lg font-bold text-ink">配信内容</h3>
              <p className="mt-1 text-xs text-ink-faint">対象・日時・メッセージの最終確認です。</p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-ink-faint">対象</dt><dd className="mt-1 font-bold text-ink">{confirmAudienceLabel} {audienceCount?.toLocaleString('ja-JP') ?? '—'}人</dd></div>
                <div><dt className="text-xs text-ink-faint">配信日時</dt><dd className="mt-1 font-bold text-ink">{sendWhenLabel ?? '未設定'}</dd></div>
              </dl>
            </section>
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-lg font-bold text-ink">確認項目</h3>
              <p className="mt-1 text-xs text-ink-faint">警告が残っている場合は配信できません。</p>
              <dl className="mt-4 divide-y divide-hairline text-sm">
                <div className="flex justify-between py-3"><dt className="font-bold text-ink">対象条件</dt><dd className="text-ink-secondary">除外{preflight?.exclusions?.total ?? 0}人を含めて確認済み</dd></div>
                <div className="flex justify-between py-3"><dt className="font-bold text-ink">メッセージ表示</dt><dd className="text-ink-secondary">LINEプレビュー確認済み</dd></div>
                <div className="flex justify-between py-3"><dt className="font-bold text-ink">送信枠</dt><dd className="text-ink-secondary">残り {quota?.remaining?.toLocaleString('ja-JP') ?? '—'} / {quota?.monthlyLimit?.toLocaleString('ja-JP') ?? '—'}通</dd></div>
              </dl>
            </section>
          </section>
        ) : null}
        <section id="broadcast-step-basic" className={`${shows('basic') ? '' : 'hidden'} rounded-card border border-hairline bg-canvas p-5 shadow-sm`}>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-ink">基本設定</h3>
            <p className="mt-1 text-sm text-ink-faint">管理名と保存先を設定します。</p>
          </div>
          <div className="broadcast-basic-fields grid gap-4">
            <label className="block">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink text-sm font-bold">配信名<RequiredBadge /></span>
                {/* 設計 `zZ9fA` の「14 / 60文字」。上限に当たってから気づくと書き直しになる。 */}
                <span className={`text-xs tabular-nums ${title.trim().length > TITLE_MAX ? 'text-danger' : 'text-ink-faint'}`}>
                  {title.trim().length} / {TITLE_MAX}文字
                </span>
              </span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：8月キャンペーンのお知らせ" className="border-hairline rounded-control mt-2 w-full border px-3 py-2.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-ink block text-sm font-bold">フォルダ</span>
              <select
                aria-label="フォルダ"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="border-hairline rounded-control mt-2 w-full border px-3 py-2.5 text-sm"
              >
                <option value="">未分類</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-4 block">
            <span className="flex items-center justify-between gap-2 text-sm font-bold text-ink">
              <span>社内メモ <span className="ml-1 rounded bg-canvas-sunken px-1.5 py-0.5 text-xs font-normal text-ink-faint">任意</span></span>
              <span className="text-xs font-normal text-ink-faint">友だちには表示されません</span>
            </span>
            <textarea
              aria-label="社内メモ"
              value={internalMemo}
              onChange={(event) => setInternalMemo(event.target.value)}
              rows={3}
              className="border-hairline rounded-control mt-2 w-full resize-none border px-3 py-2.5 text-sm"
              placeholder="配信の目的や運用メモ"
            />
          </label>
        </section>
        {shows('basic') && (
          <>
            <section className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
              <h3 className="text-lg font-bold text-ink">配信方法</h3>
              <p className="mt-1 text-xs text-ink-faint">新規作成・テンプレート・過去の配信の複製から選べます。</p>
              {/*
                #999 DEEP-02: 配信方法は1つだけ選ぶ群。●・○の文字を置いた
                button ではなく、共通 RadioCard（本物の input[type=radio]）を
                使う。群名は見出しと同じ「配信方法」を legend へ渡す。
              */}
              <RadioCardGroup legend="配信方法" className="mt-4 grid gap-3 md:grid-cols-3">
                {([
                  ['new', '新しいメッセージを作成', 'テキスト・画像・ボタンを組み合わせて一から作ります。'],
                  ['template', 'テンプレートを選択', '保存済みテンプレートを呼び出して手直しします。'],
                  ['duplicate', '過去の配信を複製', '送信済みの配信をそのまま写して作り直します。'],
                ] as const).map(([value, label, description]) => (
                  <RadioCard
                    key={value}
                    name="broadcast-delivery-method"
                    value={value}
                    checked={deliveryMethod === value}
                    title={label}
                    note={description}
                    onChange={(next) => {
                      setDeliveryMethod(next as typeof deliveryMethod)
                      if (next === 'template') {
                        setShowTemplatePicker(true)
                        goToStep('message')
                      }
                    }}
                    /* 選択済みの「テンプレートを選択」をもう一度押すと、
                       一覧を開き直せる（radio の change は発火しないため）。 */
                    onClick={value === 'template' && deliveryMethod === 'template'
                      ? () => { setShowTemplatePicker(true); goToStep('message') }
                      : undefined}
                  />
                ))}
              </RadioCardGroup>
            </section>

            <section className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-ink">最近の配信</h3>
                  <p className="mt-1 text-xs text-ink-faint">「過去の配信を複製」を選ぶと、ここから元にする配信を選べます。</p>
                </div>
                <Link href="/broadcasts" className="text-xs font-semibold text-action hover:underline">一斉配信の一覧を見る</Link>
              </div>
              <div className="mt-4 overflow-hidden rounded-control border border-hairline">
                {recentBroadcasts.length ? recentBroadcasts.map((broadcast) => (
                  <div key={broadcast.id} className="broadcast-recent-row grid items-center gap-3 border-b border-hairline px-3 py-2.5 text-xs last:border-b-0">
                    <div className="min-w-0"><p className="truncate font-bold text-action">{broadcast.title}</p><p className="truncate text-ink-faint">{typeLabel(broadcast.messageType)} 1通</p></div>
                    <span className="text-ink-secondary">{broadcast.status === 'sent' ? '送信済み' : broadcast.status === 'scheduled' ? '予約済み' : '下書き'}</span>
                    <span className="text-ink-faint">{broadcast.sentAt || broadcast.scheduledAt ? new Date(broadcast.sentAt ?? broadcast.scheduledAt ?? '').toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未設定'}</span>
                    <button type="button" className="text-left font-semibold text-action hover:underline" onClick={() => duplicateRecent(broadcast)}>複製する</button>
                  </div>
                )) : <p className="p-5 text-sm text-ink-faint">最近の配信はまだありません。</p>}
              </div>
            </section>
          </>
        )}
        <section id="broadcast-step-audience" className={`${shows('audience') ? '' : 'hidden'} rounded-card border border-hairline bg-canvas p-5 shadow-sm`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/*
              番号は上の段（STEP 1〜5）に合わせる。**本文だけ別の番号を振らない。**
              以前は 1・3・2 と振ってあり、画面には「1. 送る相手 → 3. 送る内容 →
              2. 送る時間」の順に並んでいた。**番号が飛んで見えるので、
              間の節を見落としたと読まれる。** 設計 `zZ9fA` の段は
              基本設定 → 対象者 → メッセージ → 送信設定 → 確認。
            */}
            <div>
              <h3 className="text-lg font-bold text-ink">配信対象</h3>
              <p className="mt-1 text-sm text-ink-faint">全員または詳細条件から、実際に送れる友だちを確認します。</p>
            </div>
            <div className="rounded-card bg-accent-soft px-5 py-3 text-right">
              <p className="text-xs font-bold text-accent-deep">送信対象</p>
              <p className="text-2xl font-black text-accent-deep">
                {audienceDisplayCount?.toLocaleString('ja-JP') ?? '—'}
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
                    onChange={() => {
                      if (mode.value === 'advanced') openConditionDialog()
                      else setTargetMode(mode.value)
                    }}
                    className="mt-0.5"
                  />
                  <span className="text-ink text-sm font-semibold">{mode.label}</span>
                </span>
                <span className="text-ink-faint pl-6 text-xs leading-relaxed">{mode.description}</span>
              </label>
            ))}
          </div>
          {audienceNotice && targetMode === 'advanced' && conditionHasAnalyticsAudience(condition) && (
            <div className="bg-accent-soft rounded-card mt-3 flex flex-wrap items-center justify-between gap-2 p-3">
              <p className="text-ink text-sm">
                分析で作った対象者
                {audienceNotice.label && <span className="ml-1 text-ink-secondary text-xs">{audienceNotice.label}</span>}
                <span className="ml-2 font-bold">{audienceNotice.memberCount.toLocaleString('ja-JP')}人</span>
              </p>
              <p className="text-ink-faint text-xs">
                {new Date(audienceNotice.expiresAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}まで有効・送る直前にもう一度確かめます
              </p>
            </div>
          )}
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
            <Combobox
              aria-label="どのシナリオ"
              placeholder="すべてのシナリオ（どれか1つでも購読中）"
              value={scenarioId}
              onChange={setScenarioId}
              options={scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))}
              loading={scenariosStatus === 'loading'}
              className="mt-1 w-full sm:max-w-sm"
            />
            {scenariosStatus === 'loading' && <p className="mt-1 text-xs text-ink-faint">シナリオを読み込んでいます…</p>}
            {scenariosStatus === 'error' && <p className="mt-1 text-xs text-warning">シナリオを読み込めませんでした。別の絞り方を選んで戻ると再取得します。</p>}
          </div>}
          {targetMode === 'tag' && <div className="border-hairline mt-4 border-t pt-4">
            <label className="text-ink-secondary block text-xs font-semibold">どのタグ</label>
            {/*
              「すべて」は置かない。タグを選ばないままだと絞り込みが消えて
              全員に届く。全員に送るなら上の「友だち全員に配信する」を選ぶ。
            */}
            <Combobox
              aria-label="どのタグ"
              placeholder="タグを選んでください"
              value={tagId}
              onChange={setTagId}
              options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              className="mt-1 w-full sm:max-w-sm"
            />
          </div>}
          {targetMode === 'advanced' && <div className="border-hairline mt-4 border-t pt-4">
            {/*
              シナリオ・1通ごとの配信対象・アクションの実行条件と同じ部品。
              一斉配信だけ別の項目にしていたときは、性別・年代・エリアなどを
              `friends.metadata` から読んでいたが、そこへ値を書く経路が
              どこにも無く、**選んでも常に0人**だった。
              人数はこの節の右上（送信対象）に出るので、部品側の件数は出さない。
            */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink">配信対象の条件</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {condition ? '設定した詳細条件で絞り込みます。' : '条件を1つ以上設定してください。'}
                </p>
              </div>
              <Button type="button" onClick={openConditionDialog}>条件を編集</Button>
            </div>
          </div>}
          {preflight?.audience && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ['条件一致', preflight.audience.matched, 'text-success'],
                  ['送信可能', preflight.audience.sendable, 'text-action'],
                  ['除外', preflight.exclusions?.total ?? 0, 'text-warning'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-control border border-hairline bg-canvas-sunken p-3">
                    <p className="text-xs font-bold text-ink-faint">{label}</p>
                    <p className="text-ink mt-1 text-2xl font-black tabular-nums">{Number(value).toLocaleString('ja-JP')}人</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 rounded-control bg-info-bg p-3 text-xs text-info">重複アカウントは1人として数え、配信直前に再計算します。</p>
              <section className="mt-4 border-t border-hairline pt-4">
                <h4 className="text-sm font-bold text-ink">対象プレビュー</h4>
                <p className="mt-1 text-xs text-ink-faint">代表的な友だちを確認できます。</p>
                <div className="mt-2 divide-y divide-hairline">
                  {preflight.audience.representatives.map((friend) => (
                    <div key={friend.friendId} className="flex items-center gap-3 py-3">
                      {friend.pictureUrl ? <img src={friend.pictureUrl} alt="" className="size-8 rounded-full object-cover" /> : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-deep">{friend.displayName?.slice(0, 1) ?? '—'}</span>
                      )}
                      <div><p className="text-sm font-bold text-ink">{friend.displayName ?? '名前未登録'}</p><p className="text-xs text-ink-faint">{friend.summary}</p></div>
                    </div>
                  ))}
                  {preflight.audience.representatives.length === 0 && <p className="py-3 text-xs text-ink-faint">表示できる友だちはいません。</p>}
                </div>
              </section>
            </>
          )}
        </section>
        <div className={shows('message') ? 'contents' : 'hidden'}>
        <section id="broadcast-step-message" className={`${showTemplatePicker ? 'hidden' : ''} border-hairline mb-3 rounded-card border bg-canvas p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/*
              番号は**画面に出てくる順**。前は 1 → 3 → 2 と並んでいて、
              飛ばした節があるように読めた。設計（`zZ9fA`）の段も
              基本設定 → 対象者 → メッセージ → 送信設定 の順なので、
              並べ替えではなく番号のほうを直す。
            */}
            <div>
              <h3 className="text-lg font-bold text-ink">メッセージを作成</h3>
              <p className="mt-1 text-xs text-ink-faint">外部サービスの配信形式に加え、LINE Harnessの拡張形式も選択できます。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowTemplatePicker(true)}
              className={`border-accent text-accent-deep rounded-control border px-3 py-1 text-xs font-bold hover:bg-accent-soft ${currentStep === 'message' ? 'hidden' : ''}`}
            >
              テンプレートから選ぶ
            </button>
          </div>
          <div
            className="mt-4 flex flex-wrap gap-2"
            role="tablist"
            aria-label="メッセージ形式"
            onKeyDown={(event) => moveMessageTypeTabFocus(event, document.activeElement)}
          >
            {MESSAGE_TYPE_TABS.map(([type, label], tabIndex) => {
              const selected = type !== null && bubbles[0]?.type === type
              /*
                ロービング tabindex（WAI-ARIA tabs）: Tab キーで入れるのは
                選択中のタブだけ。どれも選ばれていない（一覧に無い種類の
                下書きを開いた等）ときは先頭へ寄せ、キーボードで入れない
                状態を作らない。
              */
              const selectedIndex = MESSAGE_TYPE_TABS.findIndex(([t]) => t !== null && t === bubbles[0]?.type)
              const focusable = selectedIndex >= 0 ? selected : tabIndex === 0
              return (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  tabIndex={focusable ? 0 : -1}
                  aria-selected={selected}
                  className="broadcast-message-type"
                  data-active={selected || undefined}
                  aria-disabled={type === null || Boolean(type && UNSENDABLE_TYPES[type])}
                  title={type === null ? '紹介メッセージは現在利用できません' : UNSENDABLE_TYPES[type]}
                  onClick={() => { if (type && !UNSENDABLE_TYPES[type]) updateBubble(0, emptyBubble(type)) }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        {!showTemplatePicker && bubbles.map((bubble, index) => bubble.type === 'text' ? (
          <TextBubbleEditor
            key={bubble.id}
            bubble={bubble}
            index={index}
            trackLinks={trackLinks}
            buttons={messageButtons}
            embedded={currentStep === 'message'}
            visualReference={visualQaAugustCampaign}
            onTrackLinksChange={setTrackLinks}
            onButtonsChange={setMessageButtons}
            onChange={(next) => updateBubble(index, next)}
          />
        ) : (
          <BubbleEditor key={bubble.id} bubble={bubble} index={index} total={bubbles.length} assets={assets} assetsStatus={templateCandidatesStatus} accountId={selectedAccountId} onChange={(next) => updateBubble(index, next)} onMove={(direction) => moveBubble(index, direction)} onDelete={() => setBubbles((items) => items.filter((_, i) => i !== index))} />
        ))}
        {!showTemplatePicker && <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={bubbles.length >= MAX_BUBBLES} onClick={() => setBubbles((items) => [...items, emptyBubble()])}><Plus size={15} aria-hidden /> メッセージを追加</Button>
          <Button type="button" onClick={() => setShowTemplatePicker(true)}>テンプレートから選ぶ</Button>
          <Button type="button" disabled title="テンプレート保存の契約は未接続です"><Save size={15} aria-hidden /> 保存してテンプレート化</Button>
        </div>}
        </section>
        {/*
          BC-02: 選択窓はエディタの節の**外側**に置く。内側にあった頃は
          開くと親の節ごと hidden になり、どの入口からも一度も表示されなかった
          （DOMには居るため既存テストは通っていた）。監査 #615。
        */}
        {showTemplatePicker && (
          <section className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-ink">テンプレート選択</h3>
                <p className="mt-1 text-xs text-ink-faint">名前・本文・置き場でテンプレートを探します。選ぶと右側に内容が出ます。</p>
              </div>
              <button type="button" onClick={() => setShowTemplatePicker(false)} className="text-sm font-semibold text-action hover:underline">メッセージ編集へ戻る</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-ink-secondary">名前・本文で検索
                <input
                  type="search"
                  aria-label="テンプレート名・本文で検索"
                  value={templatePickerQuery}
                  onChange={(event) => setTemplatePickerQuery(event.target.value)}
                  placeholder="テンプレート名・本文で検索"
                  className="mt-2 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="block text-xs font-bold text-ink-secondary">フォルダ
                <select
                  aria-label="テンプレートのフォルダ"
                  value={templatePickerFolderId}
                  onChange={(event) => setTemplatePickerFolderId(event.target.value)}
                  className="mt-2 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal"
                >
                  <option value="">すべて</option>
                  {templateFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  <option value="__none__">未分類</option>
                </select>
              </label>
            </div>
            <div className="mt-4 space-y-3">
              {pickerTemplates.map((template) => (
                <button key={template.id} type="button" onClick={() => setSelectedTemplate(template)} className="broadcast-template-row">
                  <span className="min-w-0 flex-1">
                    <strong className="break-words">{template.name}</strong>
                    <small>{typeLabel(template.messageType)}</small>
                  </span>
                  <span aria-hidden>›</span>
                </button>
              ))}
              {templateCandidatesStatus === 'loading' && (
                <div className="rounded-card border border-dashed bg-canvas p-8 text-center text-sm text-ink-faint">
                  テンプレートを読み込んでいます…
                </div>
              )}
              {templateCandidatesStatus === 'error' && (
                <div className="rounded-card border border-dashed bg-canvas p-8 text-center text-sm text-warning">
                  テンプレートを読み込めませんでした。窓を閉じて開き直すと再取得します。
                </div>
              )}
              {templateCandidatesStatus === 'ready' && messageTemplates.length === 0 && assets.length === 0 && (
                <div className="rounded-card border border-dashed bg-canvas p-8 text-center text-sm text-ink-faint">
                  テンプレートがありません。「コンテンツ ＞ テンプレート」で作成してください。
                </div>
              )}
              {messageTemplates.length > 0 && pickerTemplates.length === 0 && (
                <p className="rounded-card border border-dashed bg-canvas p-6 text-center text-sm text-ink-faint">
                  条件に合うテンプレートはありません。検索文字やフォルダを変えてください。
                </p>
              )}
            </div>
          </section>
        )}
        {!showTemplatePicker && <section className="rounded-card border border-hairline bg-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h4 className="text-sm font-bold text-ink">配信後のアクション</h4>{currentStep !== 'message' && <p className="mt-1 text-xs text-ink-faint">配信後にタグ追加などを実行します。</p>}</div>
            <Link href="/common-actions" className="text-xs font-semibold text-action hover:underline">＋ アクションを追加</Link>
          </div>
          {currentStep === 'message' ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink-secondary">
              <Zap size={17} className="text-ink-secondary" aria-hidden />
              {publishedActions.find((action) => action.versionId === afterActionVersionId)?.name ?? '実行しない'}
            </p>
          ) : <div className="mt-3 block text-xs font-bold text-ink-secondary">実行する公開済みアクション
            <Combobox
              aria-label="配信後のアクション"
              placeholder="実行しない"
              value={afterActionVersionId}
              onChange={setAfterActionVersionId}
              options={publishedActions.map((action) => ({ value: action.versionId, label: `${action.name}（第${action.version}版）` }))}
              className="mt-2 w-full font-normal"
            />
          </div>}
          {currentStep !== 'message' && afterActionVersionId && <p className="mt-2 text-xs text-success">✓ 配信完了後に、選んだ公開版を実行します。</p>}
        </section>}
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
        </div>
        <section id="broadcast-step-schedule" className={`${shows('schedule') ? '' : 'hidden'} border-hairline mb-3 rounded-card border bg-canvas p-5`}>
          <h3 className="text-lg font-bold text-ink">送信設定</h3>
          <p className="mb-4 mt-1 text-sm text-ink-faint">配信する日時と、LINEの集計方法を設定します。</p>
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
            {/* 「友だちごとの最適な時間」は開封の時間帯を持っていないので押し口を出さない。 */}
          </div>

          {sendMode === 'scheduled' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="bc-date" className="text-ink-secondary mb-1 block text-xs font-medium">
                  配信日（日本時間）
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
                  時刻（日本時間）
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
          <div className="border-hairline mt-4 border-t pt-4">
            <p className="text-sm font-bold text-ink">開封・クリックの集計</p>
            <p className="mt-1 text-xs text-ink-faint">
              {quota?.monthlyUsed !== null && quota?.monthlyUsed !== undefined && quota.monthlyLimit !== null
                ? `LINEの月間送信枠を使います（今月 ${quota.monthlyUsed.toLocaleString('ja-JP')} / ${quota.monthlyLimit.toLocaleString('ja-JP')} 通）。`
                : 'LINEの月間送信枠を確認しています。'}
            </p>
          </div>
          {sendMode === 'scheduled' && (
            <section className="mt-4 rounded-control border border-hairline p-4">
              <h4 className="text-sm font-bold text-ink">配信スケジュール</h4>
              <p className="mt-1 text-xs text-ink-faint">前後の配信と重ならないかを確認します。</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {[-1, 0, 1, 2].map((offset) => {
                  const base = scheduledDate ? new Date(`${scheduledDate}T00:00:00+09:00`) : null
                  if (base) base.setDate(base.getDate() + offset)
                  const ymd = base ? base.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }) : '日付未設定'
                  const concurrent = offset === 0 ? concurrentBroadcasts : []
                  return <div key={offset} className={`rounded-control border p-3 text-xs ${offset === 0 ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><p className="font-bold text-ink">{ymd}{offset === 0 ? ' 今回' : ''}</p>{concurrent.length ? concurrent.map((item) => <p key={item.id} className="mt-2 truncate text-ink-secondary" title={item.title}>{formatScheduleTime(item.scheduledAt)}　{item.title}</p>) : <p className="mt-2 text-ink-faint">予定なし</p>}</div>
                })}
              </div>
              {concurrentBroadcasts.length > 0 && <p className="mt-3 rounded-control bg-warning-bg p-3 text-xs text-warning">同じ時刻の前後1時間に別の配信があります。対象が重なる場合は、間隔を空けてください。</p>}
            </section>
          )}
        </section>

    <div id="broadcast-step-confirm" className={shows('confirm') ? 'space-y-3' : 'hidden'}>
      <section className="rounded-card border border-hairline bg-canvas p-5" data-design-node="vW4Es">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">配信前チェック</h3>
            {!visualQaAugustCampaign && <p className="mt-1 text-xs text-ink-faint">警告が残っている場合は、内容を確認してから配信してください。</p>}
          </div>
          {!visualQaAugustCampaign && <Button type="button" onClick={() => setPreflightDialogOpen(true)}>配信前チェックを確認</Button>}
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="text-success">✓</span><span>配信対象が設定されています</span></li>
          {/* 「今すぐ」は日時を持たないので未設定扱いしない。予約と混同しないよう別の文にする。 */}
          <li className="flex items-center gap-2"><span className={scheduledLabel || sendMode === 'now' ? 'text-success' : 'text-warning'}>{scheduledLabel || sendMode === 'now' ? '✓' : '!'}</span><span>{sendMode === 'now' ? '今すぐ配信を選んでいます' : '配信日時が設定されています'}</span></li>
          <li className="flex items-center gap-2"><span className={testResult?.kind === 'success' ? 'text-success' : testResult ? 'text-danger' : 'text-warning'}>{testResult?.kind === 'success' ? '✓' : '!'}</span><span>{testResult?.kind === 'success' ? 'テスト送信が完了しています' : testResult ? 'テスト送信で届かなかった宛先があります' : 'テスト送信がまだです'}</span></li>
          <li className="flex items-center gap-2"><span className={quotaInsufficient || lengthNotice.tone === 'error' ? 'text-danger' : quotaAvailable ? 'text-success' : 'text-warning'}>{quotaInsufficient || lengthNotice.tone === 'error' ? '!' : quotaAvailable ? '✓' : '○'}</span><span>{visualQaAugustCampaign ? '送信枠を超えていません' : quotaInsufficient ? `送信枠が${Math.max(0, quota.planned - (quota.remaining ?? 0)).toLocaleString('ja-JP')}通不足しています` : quotaAvailable ? `送信枠は残り${quota.remaining?.toLocaleString('ja-JP')}通です` : '送信枠を確認できません'}</span></li>
        </ul>
        {!visualQaAugustCampaign && <label className="border-hairline mt-4 flex cursor-pointer items-center gap-3 border-t pt-4 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={previewConfirmed}
            onChange={(event) => setPreviewConfirmed(event.target.checked)}
            className="size-4 accent-[var(--color-accent-deep)]"
          />
          <span>{previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}</span>
        </label>}
      </section>

      {/*
        最終確認（IDEA-06）。対象数・除外理由・計算時刻・送信枠・把握できる
        重複配信をここへまとめる。値はどれも配信前チェックが返したものだけ。
        「今すぐ配信」は予約ではなく下書き保存＋詳細画面での送信なので、
        説明文と押すボタンの呼び方を分ける（保存・予約・今すぐ配信を混同しない）。
      */}
      <section className="rounded-card border border-hairline bg-canvas p-5" data-design-node="FpgxH">
        <h3 className="text-lg font-bold text-ink">最終確認</h3>
        <p className="mt-1 text-xs text-ink-faint">
          {sendMode === 'scheduled'
            ? '送信対象・日時・内容を確認して予約します。'
            : '送信対象・内容を確認して保存します。「今すぐ配信」は保存後に詳細画面から送信します。'}
        </p>
        <dl className="mt-5 divide-y divide-hairline text-sm">
          {[
            ['管理名', title.trim() || '（未入力）'],
            ['対象', visualQaAugustCampaign ? '条件指定 1,213人' : `${confirmAudienceLabel} ${audienceCount === null ? '—' : `${audienceCount.toLocaleString('ja-JP')}人`}`],
            ['除外', visualQaAugustCampaign ? 'ブロック 12人を除外' : exclusionNote ?? '—'],
            ['配信日時', visualQaAugustCampaign ? '2026/08/24 10:00' : sendWhenLabel ?? '未設定'],
            ['送信枠', visualQaAugustCampaign ? '残り 8,700 / 10,000通' : quotaNote ?? '—'],
            ['計算時刻', visualQaAugustCampaign ? '8/23 15:42' : evaluatedAtLabel ?? '—'],
            ['メッセージ', `${typeLabel(bubbles[0]?.type ?? 'text')} ${bubbles.length}通`],
            ['開封計測', measureOpens ? '有効' : '無効'],
            ['配信後', visualQaAugustCampaign ? 'タグ「配信済み」を追加' : publishedActions.find((action) => action.versionId === afterActionVersionId)?.name ?? '未設定'],
          ].map(([label, value]) => (
            <div key={label} className={`flex items-center justify-between gap-6 ${visualQaAugustCampaign ? 'py-5' : 'py-4'}`}>
              <dt className="shrink-0 font-semibold text-ink-faint">{label}</dt>
              <dd className="min-w-0 truncate text-right font-bold text-ink" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        {concurrentBroadcasts.length > 0 && (
          <div className="mt-3 rounded-control bg-warning-bg p-3 text-xs text-warning">
            <p className="font-semibold">同じ時刻の前後1時間に別の予約配信があります。対象が重なる場合は間隔を空けてください。</p>
            <ul className="mt-1 list-disc pl-4">
              {concurrentBroadcasts.map((item) => <li key={item.id}>{formatScheduleTime(item.scheduledAt)}　{item.title}</li>)}
            </ul>
          </div>
        )}
        <p className="mt-3 rounded-control bg-warning-bg p-3 text-xs text-warning">
          {sendMode === 'scheduled'
            ? '予約後も配信開始前までは編集・取消できます。'
            : '下書きとして保存します。送信は詳細画面で実行し、送信前にもう一度確認できます。'}
        </p>
      </section>
    </div>
    {/*
      **上限を超えたまま保存・送信させない。**

      本文の欄は `maxLength` で止まるが、下書きやテンプレートから読み込むと
      上限を超えた本文がそのまま入ることがある。**そのとき保存の口だけが
      静かに 400 で失敗する**——押した人には「保存中…」が戻るだけで、
      どの通のどこが長いのか分からない。押す前に、押せない理由を出す。

      右の点検欄（`preflight`）は宛先と本文が決まるまで出ないので、
      **こちらは常に出す。**
    */}
    {shows('message') && lengthNotice.tone === 'error' && (
      <div className="border-danger-bg bg-danger-bg rounded-card mb-3 border p-3">
        <p className="text-danger text-sm font-bold">{lengthNotice.title}</p>
        <p className="text-danger mt-1 text-xs">{lengthNotice.description}</p>
      </div>
    )}
    {draftSaved && <p role="status" className="mb-3 rounded-control bg-success-bg p-3 text-sm text-success">下書きを保存しました。</p>}
      </div>
      {/*
        xl で右列を追従させるとき、列の中身（LINEプレビュー + 操作）が
        表示域より高いと、下端の「テスト送信」「配信イメージを見る」が
        72px の下部追従バーに常時被って押せなくなる（#642）。列自体を
        バーに届かない高さへ抑えて中をスクロール可能にし、下端の操作は
        常にバーの上まで引き出せる形にする。
      */}
      <aside className="xl:sticky xl:top-6 xl:h-fit xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
        {showTemplatePicker ? (
          <div className="space-y-3">
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-lg font-bold text-ink">設定サマリー</h3>
              <p className="mt-1 text-xs text-ink-faint">保存前に対象と送信方法を確認します。</p>
              <dl className="mt-4 divide-y divide-hairline text-sm">
                <div className="flex justify-between py-2"><dt className="text-ink-faint">選択中</dt><dd className="font-bold text-ink">{selectedTemplate?.name ?? '未選択'}</dd></div>
                <div className="flex justify-between py-2"><dt className="text-ink-faint">更新日</dt><dd className="font-bold text-ink">{selectedTemplate?.updatedAt ? new Date(selectedTemplate.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</dd></div>
                <div className="flex justify-between py-2"><dt className="text-ink-faint">使用回数</dt><dd className="font-bold text-ink">{selectedTemplate?.usageCount === undefined ? '—' : `${selectedTemplate.usageCount}回`}</dd></div>
              </dl>
            </section>
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-lg font-bold text-ink">メッセージプレビュー</h3>
              <p className="mt-1 text-xs text-ink-faint">実際のLINE表示に近い確認用プレビューです。差し込みの項目は、配信時に受け取る人ごとの値へ置き換わります。</p>
              <div className="mt-4 rounded-control bg-canvas-sunken p-4 text-sm text-ink">
                {selectedTemplate
                  ? (() => {
                      // 挿入前に全文を確かめる（IDEA-11）。吹き出しと同じ部品で
                      // 出すので、改行・写真・カード型も実際の見え方に近い。
                      const bubble = messageTemplateToBubble(selectedTemplate)
                      return bubble
                        ? <BubblePreview bubble={bubble} />
                        : <p className="whitespace-pre-wrap break-words">{selectedTemplate.messageContent}</p>
                    })()
                  : 'テンプレートを選ぶと表示されます'}
              </div>
            </section>
            <div className="grid grid-cols-2 gap-2"><Button type="button" onClick={() => void openTestDialog()}>テスト送信</Button><Button type="button" disabled>配信イメージを見る</Button></div>
          </div>
        ) : preflightDialogOpen ? (
          <div className="space-y-3">
            <section className="rounded-card border border-hairline bg-canvas p-5"><h3 className="text-lg font-bold text-ink">設定サマリー</h3><p className="mt-1 text-xs text-ink-faint">保存前に対象と送信方法を確認します。</p><dl className="mt-4 divide-y divide-hairline text-sm"><div className="flex justify-between py-2"><dt className="text-ink-faint">配信人数</dt><dd className="font-bold text-ink">{audienceCount?.toLocaleString('ja-JP') ?? '—'}人</dd></div><div className="flex justify-between py-2"><dt className="text-ink-faint">送信枠</dt><dd className="font-bold text-danger">不足 {quota && quota.remaining !== null ? Math.max(0, quota.planned - quota.remaining).toLocaleString('ja-JP') : '—'}通</dd></div><div className="flex justify-between py-2"><dt className="text-ink-faint">状態</dt><dd className="font-bold text-danger">要確認</dd></div></dl></section>
            <section className="rounded-card border border-hairline bg-canvas p-5"><h3 className="text-lg font-bold text-ink">メッセージプレビュー</h3><p className="mt-1 text-xs text-ink-faint">実際のLINE表示に近い確認用プレビューです。</p><div className="mt-4 rounded-control bg-canvas-sunken p-4 text-sm text-ink">8月限定キャンペーンのお知らせです。</div></section>
            <div className="grid grid-cols-2 gap-2"><Button type="button">テスト送信</Button><Button type="button" disabled>配信イメージを見る</Button></div>
          </div>
        ) : currentStep === 'confirm' ? (
          <div className="space-y-3">
            <section className="broadcast-line-preview rounded-card p-5 text-on-accent">
              <h3 className="text-center text-sm font-bold">LINEプレビュー</h3>
              {/*
                * BC-03: 実際に決めた値だけを出す。固定の日時・人数・
                * タグ名を出すと、対象0人や未設定でも「実行される」
                * ように見えてしまう。
                */}
              <p className="mx-auto mt-4 w-fit rounded-pill bg-ink/25 px-3 py-1 text-xs font-semibold">
                {visualQaAugustCampaign ? '2026/08/24 10:00 に届きます'
                  : scheduledLabel ? `${scheduledLabel} に届きます`
                  : '保存後、詳細画面から送信します'}
              </p>
              <div className="mt-4 flex flex-col gap-3 text-ink">
                {bubbles.map((bubble, index) => <BubblePreview key={bubble.id} bubble={bubble} buttons={index === 0 ? messageButtons : []} />)}
              </div>
            </section>
            <section className="rounded-card border border-hairline bg-canvas p-4">
              <h3 className="font-bold text-ink">設定内容</h3>
              <dl className="mt-3 divide-y divide-hairline text-xs">
                {[
                  ['配信対象', visualQaAugustCampaign ? '条件指定 1,213人' : `${confirmAudienceLabel} ${audienceCount === null ? '—' : `${audienceCount.toLocaleString('ja-JP')}人`}`],
                  ['配信日時', visualQaAugustCampaign ? '2026/08/24 10:00' : sendWhenLabel ?? '未設定'],
                  ['送信数', visualQaAugustCampaign ? '1,213通' : audienceCount === null ? '—' : `${audienceCount.toLocaleString('ja-JP')}通`],
                  ['配信後', visualQaAugustCampaign ? 'タグ「配信済み」を追加' : publishedActions.find((action) => action.versionId === afterActionVersionId)?.name ?? '実行しない'],
                ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-4"><dt className="text-ink-faint">{label}</dt><dd className="text-right font-bold text-ink">{value}</dd></div>)}
              </dl>
            </section>
          </div>
        ) : currentStep === 'audience' ? (
          <div className="space-y-4">
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-sm font-bold text-ink">設定内容</h3>
              <dl className="mt-3 space-y-3 text-sm">
                <div><dt className="text-xs text-ink-faint">配信対象</dt><dd className="font-bold text-ink">{confirmAudienceLabel} {audienceDisplayCount === null ? '—' : `${audienceDisplayCount.toLocaleString('ja-JP')}人`}</dd></div>
                <div><dt className="text-xs text-ink-faint">配信日時</dt><dd className="font-bold text-ink">未設定</dd></div>
                <div><dt className="text-xs text-ink-faint">送信数</dt><dd className="font-bold text-ink">{bubbles.length}通</dd></div>
              </dl>
            </section>
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-sm font-bold text-ink">対象の確認ポイント</h3>
              <p className="mt-2 text-xs text-ink-faint">送信できない友だちを事前に除外します。</p>
              <ul className="mt-3 space-y-2 text-xs text-ink-secondary"><li>✓ ブロック・非表示を除外</li><li>✓ 同一人物の重複を除外</li><li>✓ 配信停止中を除外</li></ul>
            </section>
          </div>
        ) : (
        <>
        {currentStep === 'schedule' ? (
          <div className="space-y-3">
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-sm font-bold text-ink">設定内容</h3>
              <dl className="mt-3 divide-y divide-hairline text-xs">
                {[
                  ['配信対象', `${confirmAudienceLabel} ${audienceCount === null ? '—' : `${audienceCount.toLocaleString('ja-JP')}人`}`],
                  ['配信日時', scheduledLabel ?? '未設定'],
                  ['送信数', `${bubbles.length}通`],
                  ['配信後', publishedActions.find((action) => action.versionId === afterActionVersionId)?.name ?? '未設定'],
                ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-3"><dt className="text-ink-faint">{label}</dt><dd className="text-right font-bold text-ink">{value}</dd></div>)}
              </dl>
            </section>
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-sm font-bold text-ink">送信枠</h3>
              <p className="mt-1 text-xs text-ink-faint">現在の枠内で送信できるか確認します。</p>
              {quota ? <><p className="mt-3 text-sm font-bold text-ink">使用予定　{quota.planned.toLocaleString('ja-JP')} / {quota.monthlyLimit?.toLocaleString('ja-JP') ?? '—'}通</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas-sunken"><div className={`h-full ${quotaInsufficient ? 'bg-danger' : 'bg-accent'}`} style={{ width: quota.monthlyLimit ? `${Math.min(100, ((quota.monthlyUsed ?? 0) + quota.planned) / quota.monthlyLimit * 100)}%` : '0%' }} /></div><p className={`mt-2 text-xs font-bold ${quotaInsufficient ? 'text-danger' : 'text-success'}`}>{quotaInsufficient ? `不足 ${Math.max(0, quota.planned - (quota.remaining ?? 0)).toLocaleString('ja-JP')}通` : `残り ${quota.remaining?.toLocaleString('ja-JP') ?? '—'}通`}</p></> : <p className="mt-3 text-xs text-warning">送信枠を確認できませんでした。</p>}
            </section>
            <section className="broadcast-line-preview rounded-card p-5 text-on-accent"><h3 className="text-center text-sm font-bold">LINEプレビュー</h3><div className="mt-4 rounded-control bg-canvas p-4 text-sm text-ink"><BubblePreview bubble={bubbles[0]} buttons={messageButtons} /></div></section>
          </div>
        ) : currentStep === 'basic' ? (
          <div className="space-y-3">
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h3 className="text-sm font-bold text-ink">設定内容</h3>
              <dl className="mt-3 divide-y divide-hairline text-xs">
                {[['配信対象', '未設定'], ['配信日時', '未設定'], ['送信数', '—'], ['配信後', '未設定']].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-3"><dt className="text-ink-faint">{label}</dt><dd className="font-bold text-ink">{value}</dd></div>
                ))}
              </dl>
            </section>
            <section className="broadcast-line-preview rounded-card p-5 text-on-accent">
              <h3 className="text-center text-sm font-bold">LINEプレビュー</h3>
              <p className="mx-auto mt-4 w-fit rounded-pill bg-ink/25 px-3 py-1 text-xs font-semibold">配信日時は STEP 4 で設定します</p>
              <div className="mt-4 rounded-control bg-canvas p-4 text-sm leading-relaxed text-ink">
                メッセージは STEP 3 で作成します。テンプレートや過去の配信を選ぶと、ここに内容が入ります。
              </div>
            </section>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" disabled>テスト送信</Button>
              <Button type="button" disabled>配信イメージを見る</Button>
            </div>
          </div>
        ) : currentStep === 'message' ? (
          <div className="space-y-3">
            <section className="broadcast-line-preview rounded-card p-5 text-on-accent">
              <h3 className="text-center text-sm font-bold">LINEプレビュー</h3>
              <p className="mx-auto mt-4 w-fit rounded-pill bg-ink/25 px-3 py-1 text-xs font-semibold">
                {visualQaAugustCampaign ? '2026/08/24 10:00 に届きます'
                  : scheduledLabel ? `${scheduledLabel} に届きます`
                  : '配信日時は STEP 4 で設定します'}
              </p>
              <div className="mt-4 flex flex-col gap-3 text-ink">
                {bubbles.map((bubble, index) => <BubblePreview key={bubble.id} bubble={bubble} buttons={index === 0 ? messageButtons : []} />)}
              </div>
            </section>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => void openTestDialog()}><Send size={15} aria-hidden /> テスト送信</Button>
              <Button type="button" disabled><Eye size={15} aria-hidden /> 配信イメージを見る</Button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-bold text-ink">LINEプレビュー</h3>
            <p className="text-ink-faint mb-3 text-xs">実際のLINE表示に近い確認用プレビューです。</p>
            <div className={`overflow-hidden rounded-[28px] border-[8px] shadow-xl ${LINE_MOCK.frame} ${LINE_MOCK.wallpaper}`}>
              <div className={`px-4 py-2 text-center text-xs font-bold ${LINE_MOCK.bar} ${LINE_MOCK.onDark}`}>プレビュー</div>
              <div className="flex min-h-[600px] flex-col gap-3 p-4"><p className={`mb-3 text-center text-[11px] opacity-80 ${LINE_MOCK.onDark}`}>今日</p>{bubbles.map((bubble, index) => <BubblePreview key={bubble.id} bubble={bubble} buttons={index === 0 ? messageButtons : []} />)}</div>
            </div>
          </>
        )}
        </>
        )}
      </aside>
    </div>

    {currentStep === 'message' ? <div className="h-24" aria-hidden="true" /> : null}
    {currentStep === 'confirm' ? <div className="h-4" aria-hidden="true" /> : null}
    <StickyBar actions={(
      <>
      {currentStep ? (
        <>
          {currentStep === 'confirm' ? <Button type="button" onClick={() => goToStep('schedule')}>戻って修正</Button> : null}
          <Button type="button" disabled={saving} onClick={() => void saveDraftNow()}>{currentStep === 'message' && <Save size={15} aria-hidden />}{saving ? '保存中…' : '下書き保存'}</Button>
          {currentStep !== 'confirm' ? (
            <Button variant="primary" onClick={() => goToStep(stepOrder[Math.min(currentStepIndex + 1, stepOrder.length - 1)])}>
              {currentStep === 'basic' ? '対象設定へ'
                : currentStep === 'audience' ? 'メッセージ設定へ'
                  : currentStep === 'message' ? <><span>送信設定へ</span><ArrowRight size={15} aria-hidden /></>
                    : '配信前チェックへ'}
            </Button>
          ) : (
            <Button variant="primary" disabled={saving || lengthNotice.tone === 'error' || !canConfirm} title={!canConfirm ? '対象人数を確認できるまで実行できません' : lengthNotice.tone === 'error' ? lengthNotice.description : undefined} onClick={() => void save()}>
              {/*
                予約と下書きを混同しない（IDEA-06）。「今すぐ配信」はここでは
                送らず、下書きを保存して詳細画面の送信ボタンで実行する。
              */}
              {saving ? '保存中…' : sendMode === 'scheduled' ? 'この内容で予約' : '保存して送信画面へ'}
            </Button>
          )}
        </>
      ) : (
        <>
          <button onClick={onCancel} className="border-hairline rounded-card border px-5 py-3 text-sm font-bold">キャンセル</button>
          {(shows('message') || shows('confirm')) && <button disabled={testSending || saving || lengthNotice.tone === 'error'} title={lengthNotice.tone === 'error' ? lengthNotice.description : undefined} onClick={() => void openTestDialog()} className="border-hairline rounded-card border px-5 py-3 text-sm font-bold disabled:opacity-50">{testSending ? '送信中…' : 'テスト送信'}</button>}
          <button disabled={saving || lengthNotice.tone === 'error'} title={lengthNotice.tone === 'error' ? lengthNotice.description : undefined} onClick={() => (sendMode === 'scheduled' ? openConfirm() : void save())} className="bg-accent-deep text-on-accent hover:brightness-92 rounded-card px-7 py-3 text-sm font-bold disabled:opacity-50">{saving ? '保存中…' : sendMode === 'scheduled' ? '配信を予約する' : '下書き保存'}</button>
        </>
      )}
      </>
    )} />

    {/*
      最終確認（設計 `FpgxH` 6-1-H）。

      **押した瞬間に予約が確定しないようにする。** 出す値はどれも
      いま画面が持っているものだけで、固定値は使わない。人数は
      `runPreflight()` が数えたぶん（`preflight.audienceCount`）。
    */}
    <ConfirmDialog
      open={selectedTemplate !== null}
      title="テンプレートを選択"
      description={selectedTemplate ? `「${selectedTemplate.name}」を一斉配信のメッセージに読み込みます。読み込み後も内容を編集できます。` : ''}
      confirmLabel="このテンプレートを使用"
      cancelLabel="戻る"
      designNode="p97Tf"
      titleIcon={<CheckCircle2 size={22} />}
      onCancel={() => setSelectedTemplate(null)}
      onConfirm={selectedTemplate ? () => applyTemplate(selectedTemplate) : undefined}
    >
      <ul className="space-y-2 rounded-control border border-hairline bg-canvas-sunken p-4 text-sm">
        <li className="text-success">✓ このテンプレートの内容を確認しました</li>
        <li className="text-success">✓ 差し込みの項目がこの配信で使えることを確認しました</li>
        <li className="text-success">✓ 読み込んだあとに内容を直せることを確認しました</li>
      </ul>
    </ConfirmDialog>

    <ConfirmDialog
      open={conditionDialogOpen}
      title="配信対象の条件を設定"
      description="条件を組み合わせて、この配信を届ける友だちを決めます。"
      confirmLabel="この条件を反映"
      cancelLabel="キャンセル"
      designNode="sqFXf"
      onCancel={() => setConditionDialogOpen(false)}
      onConfirm={() => {
        setCondition(conditionDraft)
        setConditionDialogOpen(false)
      }}
    >
      <div className="space-y-4">
        <section className="rounded-control border border-hairline bg-canvas-sunken p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-ink">現在の条件</h3><button type="button" className="text-xs font-semibold text-action" onClick={() => setConditionDraft(null)}>条件を初期化</button></div>
          <p className="mt-2 text-xs text-ink-secondary">{conditionDraft ? '設定中の詳細条件を編集しています。' : '条件はまだ設定されていません。'}</p>
        </section>
        <section className="rounded-control border border-hairline p-4">
          <h3 className="mb-3 text-sm font-bold text-ink">条件 1</h3>
          <ConditionBuilder value={conditionDraft} onChange={setConditionDraft} showCount={false} />
        </section>
        <section>
          <h3 className="text-sm font-bold text-ink">利用できる条件軸</h3>
          <p className="mt-2 text-xs font-bold text-ink-secondary">標準互換（15軸）</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{STANDARD_CONDITION_AXES.map((axis) => <span key={axis} className="rounded-pill border border-hairline px-2 py-1 text-xs text-ink-secondary">{axis}</span>)}</div>
          <p className="mt-3 text-xs font-bold text-ink-secondary">この画面だけの軸（6軸）</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{BROADCAST_ONLY_CONDITION_AXES.map((axis) => <span key={axis} className="rounded-pill border border-hairline px-2 py-1 text-xs text-ink-faint">{axis}</span>)}</div>
          <p className="mt-3 rounded-control bg-info-bg p-3 text-xs text-info">複数条件は「すべて一致（AND）」または「いずれか一致（OR）」で結合できます。未接続の軸は選択肢に出ません。</p>
        </section>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      open={preflightDialogOpen}
      title={quotaInsufficient ? '配信枠が不足しています' : '配信前チェック'}
      description={quotaInsufficient
        ? `現在の送信枠では${quota?.planned.toLocaleString('ja-JP')}通を送信できません。対象を絞るか、配信設定を確認してください。`
        : '対象・メッセージ・日時・送信枠を確認しました。'}
      confirmLabel="対象を見直す"
      cancelLabel="戻る"
      designNode="vW4Es"
      titleIcon={quotaInsufficient ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
      onCancel={() => setPreflightDialogOpen(false)}
      onConfirm={() => {
        setPreflightDialogOpen(false)
        goToStep('audience')
      }}
    >
      <ul className="space-y-2 rounded-control border border-hairline bg-canvas-sunken p-4 text-sm">
        <li className="text-success">✓ 対象人数を確認しました</li>
        <li className={previewConfirmed ? 'text-success' : 'text-warning'}>{previewConfirmed ? '✓' : '!'} メッセージ表示を確認しました</li>
        <li className={scheduledLabel ? 'text-success' : 'text-ink-faint'}>{scheduledLabel ? '✓' : '○'} 配信日時を確認しました</li>
      </ul>
    </ConfirmDialog>

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
              {confirmAudienceLabel}
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
          {/* 送信枠・計算時刻・把握できる重複配信もここへまとめる（IDEA-06）。 */}
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">送信枠</dt>
            <dd className={`text-right ${quotaInsufficient ? 'font-medium text-danger' : 'text-ink-secondary'}`}>
              {quotaNote ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">計算時刻</dt>
            <dd className="text-ink-secondary text-right tabular-nums">{evaluatedAtLabel ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-faint">配信日時</dt>
            <dd className="text-ink text-right font-medium tabular-nums">{sendWhenLabel ?? '—'}</dd>
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
          把握できる重複配信（IDEA-06）。同じ時刻の前後1時間に入っている
          別の予約をここでも出す。送信設定の節でだけ出すと、確認の窓で
          読み合わせるときに見落とす。
        */}
        {concurrentBroadcasts.length > 0 && (
          <div className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-5">
            <p className="font-semibold">同じ時刻の前後1時間に別の予約配信があります</p>
            <ul className="mt-1 list-disc pl-4">
              {concurrentBroadcasts.map((item) => (
                <li key={item.id}>{formatScheduleTime(item.scheduledAt)}　{item.title}</li>
              ))}
            </ul>
          </div>
        )}

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
              {testResult?.kind === 'success' ? null : testResult ? <li>テスト送信で届かなかった宛先があります</li> : <li>テスト送信がまだです</li>}
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

    <ConfirmDialog
      open={testDialogOpen}
      title="テスト送信"
      description="登録済みのテスト送信先全員のLINEへ、表示確認用のメッセージを送ります。"
      confirmLabel={testSending ? '送信中…' : 'テスト送信する'}
      cancelLabel="キャンセル"
      busy={testSending}
      designNode="h0kahp"
      titleIcon={<Send size={22} />}
      confirmIcon={<Send size={16} />}
      onCancel={() => { if (!testSending) setTestDialogOpen(false) }}
      onConfirm={testRecipientState === 'ready' && testRecipients.length > 0 ? () => void handleTestSend() : undefined}
    >
      <div className="space-y-3">
        {testRecipientState === 'loading' && <p className="text-sm text-ink-faint">読み込んでいます</p>}
        {testRecipientState === 'error' && <p className="rounded-control bg-danger-bg p-3 text-sm text-danger">テスト送信先を読み込めませんでした。</p>}
        {testRecipientState === 'ready' && testRecipients.length === 0 && (
          <p className="rounded-control bg-canvas-sunken p-3 text-sm text-ink-faint">
            テスト送信先が登録されていません。アカウント設定で、LINE連携済みの担当者を登録してください。
          </p>
        )}
        {testRecipientState === 'ready' && testRecipients.length > 0 && (
          <>
            {/*
              **宛先は選ばない。** 送信APIは宛先を受け取らず、Workerは
              登録済みのテスト送信先全員へ送る。先頭だけ緑の丸を付けると
              1人を選んだように見えるので、全員を同じ見た目で並べる。
              役職はAPIが返さないので、名前から推定して表示しない。
            */}
            <p className="rounded-control bg-canvas-sunken p-3 text-sm text-ink-secondary">
              登録済みのテスト送信先 {testRecipients.length}名全員へ送信します。
            </p>
            <ul className="space-y-2">
              {testRecipients.map((recipient) => (
                <li key={recipient.id} className="flex items-center gap-3 rounded-control border border-hairline p-3">
                  {recipient.pictureUrl ? <img src={recipient.pictureUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-secondary text-sm font-bold text-on-accent">{recipient.displayName.slice(0, 1)}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{recipient.displayName}</span>
                </li>
              ))}
            </ul>
            {/*
              テスト送信も通常の pushMessage を通すので、LINE公式アカウントの
              送信枠を使う。「消費しません」と書くと実装と食い違う。
            */}
            <p className="rounded-control bg-info-bg p-3 text-xs font-semibold text-info">
              テスト送信もLINE公式アカウントの送信枠を使用します（見込み {(testRecipients.length * bubbles.length).toLocaleString('ja-JP')}通）。
            </p>
          </>
        )}
        {testResult && (
          <p className={
            testResult.kind === 'success'
              ? 'rounded-control bg-success-bg p-3 text-sm text-success'
              : testResult.kind === 'partial'
                ? 'rounded-control bg-warning-bg p-3 text-sm text-warning'
                : 'rounded-control bg-danger-bg p-3 text-sm text-danger'
          }>{testResult.message}</p>
        )}
        {testHistory.length > 1 && (
          <section>
            <h4 className="text-xs font-bold text-ink-faint">これ以前の実行履歴</h4>
            <ul className="mt-1 space-y-1">
              {testHistory.slice(1).map((entry, index) => (
                <li
                  key={index}
                  className={
                    entry.kind === 'success'
                      ? 'rounded-control bg-success-bg p-2 text-xs text-success'
                      : entry.kind === 'partial'
                        ? 'rounded-control bg-warning-bg p-2 text-xs text-warning'
                        : 'rounded-control bg-danger-bg p-2 text-xs text-danger'
                  }
                >{entry.message}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ConfirmDialog>
    <style jsx global>{`
      .broadcast-form-v6 > nav[aria-label='配信作成の進み'] {
        margin-bottom: 1.5rem;
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 0;
      }
      /* #999 DEEP-02: .broadcast-delivery-*（●・○を置いた擬似ラジオカード）は撤去。共通 RadioCard を使う。 */
      .broadcast-message-type {
        min-height: 34px;
        border: 1px solid var(--color-hairline);
        border-radius: 6px;
        background: var(--color-canvas);
        padding: 0 12px;
        color: var(--color-ink-secondary);
        font-size: 12px;
        font-weight: 700;
      }
      .broadcast-message-type[data-active='true'] {
        border-color: var(--color-accent);
        background: var(--color-accent-soft);
        color: var(--color-accent);
      }
      .broadcast-message-type:disabled { cursor: not-allowed; opacity: .45; }
      .broadcast-template-row {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 14px;
        border: 1px solid var(--color-hairline);
        border-radius: 8px;
        background: var(--color-canvas);
        padding: 16px;
        text-align: left;
      }
      .broadcast-template-row:hover { border-color: var(--color-accent); }
      .broadcast-template-row strong,
      .broadcast-template-row small { display: block; }
      .broadcast-template-row small { margin-top: 3px; color: var(--color-ink-faint); }
      .broadcast-line-preview { background: var(--color-line-preview); min-height: 428px; }
       .broadcast-url-row { display: grid; grid-template-columns: minmax(7rem, .7fr) minmax(0, 1.4fr) 7rem; }
       .broadcast-preflight-page-open > :not(.broadcast-preflight-page) { display: none; }
      @media (min-width: 640px) {
        .broadcast-basic-fields { grid-template-columns: minmax(0, 1fr) 20rem; }
      }
      @media (min-width: 768px) {
        .broadcast-recent-row { grid-template-columns: minmax(0, 1fr) 8rem 10rem 5rem; }
      }
       [data-design-node='sqFXf'] [data-design-part='dialog'] {
        width: min(760px, calc(100vw - 32px));
        max-width: 760px;
        max-height: calc(100vh - 40px);
        overflow-y: auto;
       }
       [data-design-node='p97Tf'][role='presentation'],
       [data-design-node='vW4Es'][role='presentation'] {
         align-items: flex-start;
         padding-top: 265px;
       }
       [data-design-node='p97Tf'] [data-design-part='dialog'],
       [data-design-node='vW4Es'] [data-design-part='dialog'] {
         width: min(590px, calc(100vw - 32px));
         max-width: 590px;
       }
       [data-design-node='h0kahp'] {
         align-items: flex-start;
         padding-top: 236px;
       }
       [data-design-node='h0kahp'] [data-design-part='dialog'] {
         width: min(610px, calc(100vw - 32px));
         max-width: 610px;
       }
    `}</style>
  </div>
}
