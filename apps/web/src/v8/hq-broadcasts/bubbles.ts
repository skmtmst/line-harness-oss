/*
 * 統括の一括配信の吹き出し（③ メッセージを作成・絵 lLyFR）。
 *
 * 種類のタブは絵の並び（テキスト・画像・動画・音声・スタンプ・カルーセル・リッチメッセージ・位置情報・質問・紹介・その他）。
 * 「その他」は統括だけの種類（クーポン）。口（hq-broadcasts の messageBubblesJson）へは店の一斉配信と同じ吹き出しの形で送り、
 * 入力の確かめも店と同じ関数（動画のプレビュー・位置情報/音声/スタンプ・カルーセル・素材の変換）を使う。
 * 質問・紹介は統括の口がまだ受けないので、タブは出して「まだ統括からは送れません」の1行だけにし、保存させない。
 */
import type { BroadcastBubble, MessageTemplateDefinition } from '@line-crm/shared'
import { videoPreviewProblem } from '@/components/broadcasts/broadcast-form'
import { carouselColumnsProblem } from '@/components/broadcasts/bubble-content-check'
import { emptyMessageKindState, messageKindProblem, type MessageKind, type MessageKindState } from '@/components/scenarios/message-kind-fields'
import { assetBubbleError } from '@/lib/broadcast-template'
import { fromApiContent, toApiContent, type HqKind } from './model'

/** 吹き出し1つ。content は口へ送る中身（テキストは body）。カルーセルは素材（カードタイプ）のとき cardAsset。 */
export type HqBubble = { id: string; kind: HqKind; body: string; content: Record<string, unknown>; cardAsset?: boolean }

/** 絵 lLyFR のタブの並び。最後の「その他」はクーポン。 */
export const HQ_KIND_TABS: ReadonlyArray<readonly [HqKind, string]> = [
  ['text', 'テキスト'], ['image', '画像'], ['video', '動画'], ['audio', '音声'], ['sticker', 'スタンプ'],
  ['carousel', 'カルーセル'], ['rich', 'リッチメッセージ'], ['location', '位置情報'], ['question', '質問'], ['intro', '紹介'],
  ['coupon', 'その他'],
]

export const HQ_KIND_LABEL: Record<HqKind, string> = {
  text: 'テキスト', image: '画像', video: '動画', audio: '音声', sticker: 'スタンプ', carousel: 'カルーセル',
  rich: 'リッチメッセージ', location: '位置情報', question: '質問', intro: '紹介', coupon: 'クーポン',
}

/** 統括の口がまだ受けない種類。 */
export const HQ_NOT_YET: ReadonlySet<HqKind> = new Set<HqKind>(['question', 'intro'])
export const notYetText = (kind: HqKind) => `${HQ_KIND_LABEL[kind]}は、まだ統括からは送れません。送るときは店の一斉配信で作ってください`

const KIND_FIELDS: ReadonlySet<HqKind> = new Set<HqKind>(['audio', 'sticker', 'location'])

export function emptyContent(kind: HqKind): Record<string, unknown> {
  if (kind === 'image' || kind === 'video') return { originalContentUrl: '', previewImageUrl: '' }
  if (KIND_FIELDS.has(kind)) return { state: emptyMessageKindState() }
  return {}
}

export function newHqBubble(kind: HqKind = 'text'): HqBubble {
  return { id: `hq-b-${Math.random().toString(36).slice(2, 10)}`, kind, body: '', content: emptyContent(kind) }
}

/** 口へ送る吹き出し（店の一斉配信と同じ形）。まだ送れない種類は null。 */
export function toApiBubble(item: HqBubble, id: string): BroadcastBubble | null {
  switch (item.kind) {
    case 'text': return { id, type: 'text', content: { text: toApiContent(item.body) } }
    case 'image': case 'video': case 'audio': case 'sticker': case 'location': return { id, type: item.kind, content: item.content }
    case 'carousel': return { id, type: item.cardAsset ? 'card_message' : 'carousel', content: item.content }
    case 'rich': return { id, type: 'rich_message', content: item.content }
    case 'coupon': return { id, type: 'coupon', content: item.content }
    default: return null
  }
}

/** 保存した吹き出し（口の messageBubblesJson の1つ）を画面の吹き出しに戻す。読めない種類は null。 */
export function fromApiBubble(raw: { type?: string; content?: Record<string, unknown> }): HqBubble | null {
  const content = raw.content && typeof raw.content === 'object' ? raw.content : {}
  const base = newHqBubble('text')
  switch (raw.type) {
    case 'text': return typeof content.text === 'string' ? { ...base, body: fromApiContent(content.text) } : null
    case 'image': case 'video': case 'audio': case 'sticker': case 'location': return { ...base, kind: raw.type, content }
    case 'carousel': return { ...base, kind: 'carousel', content }
    case 'card_message': return { ...base, kind: 'carousel', content, cardAsset: true }
    case 'rich_message': return { ...base, kind: 'rich', content }
    case 'coupon': return { ...base, kind: 'coupon', content }
    default: return null
  }
}

/** カルーセルのカード（口の columns）。読めなければ空。 */
export function carouselColumns(item: Pick<HqBubble, 'content' | 'cardAsset'>): Array<Record<string, unknown>> {
  if (item.cardAsset) {
    const cards = item.content.cards ?? item.content.columns
    return Array.isArray(cards) ? cards as Array<Record<string, unknown>> : []
  }
  try {
    const parsed = JSON.parse(String(item.content.columnsJson ?? '')) as unknown
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : []
  } catch {
    return []
  }
}

/**
 * カルーセルのボタンで「動きを実行する」（postback）は、押されたときに店のテンプレートの動きを探す。
 * 統括のひな形をそのまま送ると、店にそのテンプレートが無いので押しても何も起きない。口が付け替えるまで止める。
 */
export function carouselPostbackProblem(item: Pick<HqBubble, 'content' | 'cardAsset'>): string | null {
  if (item.cardAsset) return null
  const postback = carouselColumns(item).some((column) => Array.isArray(column.actions)
    && (column.actions as Array<Record<string, unknown>>).some((action) => action?.type === 'postback'))
  return postback ? 'ボタンで動きを実行するカルーセルは、まだ統括からは送れません。URLを開くボタンだけのカルーセルを選んでください' : null
}

/** 吹き出しの入れ忘れ・送れない形。店の一斉配信と同じ確かめ。問題なければ null。 */
export function hqBubbleProblem(item: HqBubble): string | null {
  if (HQ_NOT_YET.has(item.kind)) return notYetText(item.kind)
  if (item.kind === 'text') return item.body.trim() ? null : '本文を入れてください'
  if (item.kind === 'image' || item.kind === 'video') {
    if (!item.content.originalContentUrl) return `${HQ_KIND_LABEL[item.kind]}のファイルをアップロードしてください`
    return item.kind === 'video' ? videoPreviewProblem(item.content.previewImageUrl) : null
  }
  if (KIND_FIELDS.has(item.kind)) {
    const state = item.content.state as MessageKindState | undefined
    return state ? messageKindProblem(item.kind as MessageKind, state) : `${HQ_KIND_LABEL[item.kind]}を入力してください`
  }
  if (item.kind === 'carousel') {
    if (!item.content.templateName && !item.content.assetName) return 'カルーセルを選んでください'
    if (item.cardAsset) return assetBubbleError({ id: 'check', type: 'card_message', content: item.content }) || null
    return carouselColumnsProblem(item.content.columnsJson) ?? carouselPostbackProblem(item)
  }
  if (item.kind === 'rich' || item.kind === 'coupon') {
    if (!item.content.assetId) return `${HQ_KIND_LABEL[item.kind]}を選んでください`
    return assetBubbleError({ id: 'check', type: item.kind === 'rich' ? 'rich_message' : 'coupon', content: item.content }) || null
  }
  return null
}

/** 1行の要約（開いていない吹き出しの見出し。絵：「カルーセル ・ 秋の新商品 3種（カード1枚）」）。 */
export function hqBubbleSummary(item: HqBubble): string {
  const label = HQ_KIND_LABEL[item.kind]
  if (item.kind === 'text') return item.body.trim() ? `テキスト ・ ${item.body.trim().slice(0, 40)}` : 'テキスト ・ 本文がまだありません'
  if (HQ_NOT_YET.has(item.kind)) return `${label} ・ 統括からは送れません`
  if (item.kind === 'carousel') {
    const name = String(item.content.templateName ?? item.content.assetName ?? '')
    return name ? `${label} ・ ${name}（カード${carouselColumns(item).length}枚）` : `${label} ・ まだ選んでいません`
  }
  if (item.kind === 'rich' || item.kind === 'coupon') return `${label} ・ ${String(item.content.assetName ?? '') || 'まだ選んでいません'}`
  return hqBubbleProblem(item) ? `${label} ・ まだ入れていません` : `${label} ・ 入力済み`
}

/** LINE の見え方の例に出す1行（テキストは呼ぶ側が差し込みを置き換える）。 */
export function hqBubblePreview(item: HqBubble): string {
  if (item.kind === 'carousel' || item.kind === 'rich' || item.kind === 'coupon') {
    const name = String(item.content.templateName ?? item.content.assetName ?? '')
    if (!name) return ''
    return item.kind === 'carousel' ? `［カルーセル］${name}（カード${carouselColumns(item).length}枚）` : `［${HQ_KIND_LABEL[item.kind]}］${name}`
  }
  if (item.kind === 'location') {
    const state = item.content.state as MessageKindState | undefined
    return state?.location.title ? `［位置情報］${state.location.title}` : '［位置情報］'
  }
  if (HQ_NOT_YET.has(item.kind)) return ''
  return `［${HQ_KIND_LABEL[item.kind]}］`
}

/** 統括のひな形を吹き出しへ読む。読めない種類は理由。 */
export function bubbleFromTemplate(templateId: string, definition: MessageTemplateDefinition): { bubble: HqBubble } | { error: string } {
  const base = newHqBubble('text')
  const name = definition.template.name
  if (definition.asset) {
    const content = { assetId: templateId, assetName: name, ...(definition.asset.payload as Record<string, unknown>) }
    if (definition.asset.kind === 'coupon') return { bubble: { ...base, kind: 'coupon', content } }
    if (definition.asset.kind === 'rich_message') return { bubble: { ...base, kind: 'rich', content } }
    if (definition.asset.kind === 'card_message') return { bubble: { ...base, kind: 'carousel', content, cardAsset: true } }
    return { error: `${definition.asset.kind === 'research' ? 'リサーチ' : 'この種類'}のひな形は、まだ統括からは送れません` }
  }
  if (definition.template.questionJson) return { error: '質問のひな形は、まだ統括からは送れません' }
  const { messageType, messageContent } = definition.template
  if (messageType === 'text') return { bubble: { ...base, body: fromApiContent(messageContent) } }
  if (messageType === 'carousel') return { bubble: { ...base, kind: 'carousel', content: { templateId: '', hqTemplateId: templateId, templateName: name, columnsJson: messageContent } } }
  if (messageType === 'image') {
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(messageContent) as Record<string, unknown> } catch { parsed = {} }
    const url = String(parsed.originalContentUrl ?? definition.media[0]?.publicUrl ?? '')
    if (url.startsWith('https://')) return { bubble: { ...base, kind: 'image', content: { originalContentUrl: url, previewImageUrl: String(parsed.previewImageUrl ?? url) } } }
    return { error: 'この画像のひな形は、まだ統括からは読み込めません。画像のタブでアップロードしてください' }
  }
  return { error: 'Flex のひな形は、まだ統括からは送れません' }
}
