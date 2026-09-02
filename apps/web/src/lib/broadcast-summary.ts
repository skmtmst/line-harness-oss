/*
 * 一覧に出す「何を・誰に送ったか」の要約。
 *
 * 一覧は**送ったあとに確かめる**ための画面でもある。ここが違うものを
 * 出していると、確かめたつもりで確かめられていない。
 *
 * 実際に間違っていた:
 *   - 種別は text / image / Flex の3つしか見ていなかったので、
 *     スタンプもカルーセルも位置情報も**すべて「Flex」**と出ていた
 *   - 宛先は「全員」か「タグ指定」の2つしか見ていなかったので、
 *     詳細条件で絞った配信も**「タグ指定」**と出ていた
 */

import type { SegmentCondition } from './segment-condition'

const TYPE_LABELS: Record<string, string> = {
  text: 'テキスト',
  image: '写真',
  flex: 'カード型',
  location: '位置情報',
  video: '動画',
  audio: '音声',
  sticker: 'スタンプ',
  carousel: 'カルーセル',
}

/** 送るものの種別。知らない種別はそのまま出す（「Flex」と嘘をつかない）。 */
export function messageTypeLabel(messageType: string): string {
  return TYPE_LABELS[messageType] ?? messageType
}

/**
 * 本文の抜粋。
 *
 * テキスト以外は中身が JSON なので、そのまま出すと `{"packageId":…}` が
 * 並ぶ。種別ごとに「見て分かる1行」にする。
 */
export function contentExcerpt(messageType: string, messageContent: string, limit = 40): string {
  const trimmed = (messageContent ?? '').trim()
  if (!trimmed) return ''

  if (messageType === 'text') {
    const oneLine = trimmed.replace(/\s+/g, ' ')
    return oneLine.length > limit ? `${oneLine.slice(0, limit)}…` : oneLine
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // 読めないものは種別だけ出す。壊れた JSON を一覧に流さない。
    return messageTypeLabel(messageType)
  }

  if (messageType === 'carousel' && Array.isArray(parsed)) {
    const first = parsed[0] as { title?: unknown; text?: unknown } | undefined
    const head = typeof first?.title === 'string' && first.title
      ? first.title
      : typeof first?.text === 'string' ? first.text : ''
    return head ? `${head}（${parsed.length}枚）` : `カルーセル ${parsed.length}枚`
  }

  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  if (messageType === 'location') {
    const title = typeof obj.title === 'string' ? obj.title : ''
    const address = typeof obj.address === 'string' ? obj.address : ''
    return [title, address].filter(Boolean).join(' / ') || '位置情報'
  }
  if (messageType === 'sticker') {
    return `スタンプ ${String(obj.packageId ?? '')}-${String(obj.stickerId ?? '')}`
  }
  if (messageType === 'audio') {
    const ms = Number(obj.duration)
    return Number.isFinite(ms) && ms > 0 ? `音声 ${Math.round(ms / 1000)}秒` : '音声'
  }
  if (messageType === 'flex') {
    // Flex は本文がどこにあるか決まっていないので、最初の text を拾う。
    const found = findFirstText(parsed)
    return found ? (found.length > limit ? `${found.slice(0, limit)}…` : found) : 'Flex'
  }
  return messageTypeLabel(messageType)
}

function findFirstText(node: unknown): string {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstText(item)
      if (found) return found
    }
    return ''
  }
  if (!node || typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  if (obj.type === 'text' && typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim()
  for (const value of Object.values(obj)) {
    const found = findFirstText(value)
    if (found) return found
  }
  return ''
}

/**
 * 宛先の要約。
 *
 * 条件は `is_following`（ブロック中を外す）を必ず含んでいる。これは
 * どの配信にも付くので、数え上げからは外す。付けたまま数えると
 * 「全員に送った配信」まで「詳細条件 1件」と出る。
 */
export function audienceSummary(
  broadcast: {
    targetType: string
    targetTagId?: string | null
    segmentConditions?: SegmentCondition | null
  },
  tagName: (id: string) => string | null,
): string {
  if (broadcast.targetType === 'multi-account-dedup') return '複数アカウント（重複除外）'
  if (broadcast.targetType === 'all') return '友だち全員'
  if (broadcast.targetType === 'tag') {
    const name = broadcast.targetTagId ? tagName(broadcast.targetTagId) : null
    return name ? `タグ：${name}` : 'タグ（削除済み）'
  }

  const condition = broadcast.segmentConditions
  if (!condition) return '条件なし'

  const rules = (condition.rules ?? []).filter((r) => r.type !== 'is_following')
  const groups = condition.groups ?? []

  // よく使う形は言葉にする。「詳細条件 1件」より読みやすい。
  if (groups.length === 0 && rules.length === 0) return '友だち全員'
  if (groups.length === 0 && rules.length === 1) {
    const rule = rules[0]
    if (rule.type === 'tag_exists' && typeof rule.value === 'string') {
      const name = tagName(rule.value)
      return name ? `タグ：${name}` : 'タグ（削除済み）'
    }
    if (rule.type === 'scenario_subscribed') {
      return rule.value ? '指定のシナリオを購読中' : 'シナリオ購読中の全員'
    }
  }

  const count = rules.length + groups.reduce((n, g) => n + (g.rules?.length ?? 0), 0)
  return `詳細条件 ${count} 件`
}

/**
 * 一覧の1行目に出す「内容／種別」。
 *
 * `contentExcerpt` は読めない中身のとき**種別の名前をそのまま返す**ので、
 * 素直につなぐと「写真／写真」「カルーセル／カルーセル」になる。
 * 同じ語を2度出しても何も分からないので、その場合は種別だけにする。
 */
export function rowExcerpt(messageType: string, messageContent: string): string {
  const label = messageTypeLabel(messageType)
  const excerpt = contentExcerpt(messageType, messageContent)
  if (!excerpt) return label
  if (excerpt === label) return label
  return `${excerpt}／${label}`
}
