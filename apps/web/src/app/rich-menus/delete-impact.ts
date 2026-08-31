import type { RichMenuDeleteImpact } from '@/lib/api'

/**
 * リッチメニューを消したときの影響（設計 `szXsT`／契約 #608）。
 *
 * **消したあとに何が起きるかを、押す前に言う。** これまでは
 * 「消えるもの・残るもの・戻せない」までは書けていたが、
 * **表示中の人数・次に出るメニュー・切替元・自動応答の参照**は
 * 読み口が無くて出せなかった。
 */

/** 取得元が無い値。実値の0とは別。 */
export const NOT_AVAILABLE = '—（未取得）'

/**
 * いま表示している人数。
 *
 * `value` が `null` のときは**0人ではない**。誰に出ているかの記録
 * （割り当て台帳）がまだ無いだけなので、理由を添えて未取得と書く。
 */
export function audienceText(audience: RichMenuDeleteImpact['currentAudience']): string {
  if (audience.value === null) return NOT_AVAILABLE
  return `${audience.value.toLocaleString('ja-JP')}人`
}

export function audienceReason(audience: RichMenuDeleteImpact['currentAudience']): string | null {
  if (audience.value !== null) return null
  return '誰に出ているかの記録がまだ無いため、人数は数えられません。'
}

/**
 * 次に出るメニュー。
 *
 * **「必ずこれが出ます」とは言えない。** 友だちごとの条件で決まるので、
 * 契約も `guaranteedGroupId: null` を返す。候補を並べて、決まらないことを
 * そのまま書く。
 */
export function nextDisplayText(next: RichMenuDeleteImpact['nextDisplay']): string {
  if (next.candidates.length === 0) {
    return 'このメニューを消すと、リッチメニューが出なくなる友だちがいます。'
  }
  const names = next.candidates.map((c) => c.name).join('・')
  return `友だちごとの条件で決まります。候補は ${names} です。`
}

const REFERENCE_KIND = {
  automation: 'オートメーション',
  common_action: '共通アクション',
} as const

export function referenceKindText(kind: RichMenuDeleteImpact['operationalReferences'][number]['kind']): string {
  return REFERENCE_KIND[kind]
}

const BLOCKER_TEXT = {
  published: 'LINEに登録中です。先に取り下げてください。',
  publishing: 'いまLINEへ反映しています。終わってからもう一度お試しください。',
  default_for_all: 'すべての友だちの既定になっています。ほかのメニューを既定にしてください。',
  line_resources: 'LINE上にこのメニューが残っています。先に取り下げてください。',
  incoming_switches: 'ほかのメニューからの切替先になっています。切替を外してください。',
  operational_references: '自動処理から使われています。参照を外してください。',
} as const

/**
 * 消せない理由。
 *
 * **内部の記号をそのまま出さない。** `blockers` は `published` のような
 * 英語の合図なので、何をすればよいかの日本語へ置き換える。
 */
export function blockerTexts(blockers: RichMenuDeleteImpact['blockers']): string[] {
  return blockers.map((key) => BLOCKER_TEXT[key])
}

const ACTION_TEXT = {
  delete: '消せます。',
  unpublish: '先にLINEから取り下げてください。',
  review_references: '使われている場所を先に外してください。',
} as const

export function recommendedActionText(action: RichMenuDeleteImpact['recommendedAction']): string {
  return ACTION_TEXT[action]
}

/**
 * 消してよいか。
 *
 * **`canDelete` と `blockers` の両方を見る。** どちらか一方だけだと、
 * 片方が更新されたときに押せてしまう組み合わせが残る。
 */
export function canDelete(input: {
  impact: RichMenuDeleteImpact | null
  busy: boolean
}): boolean {
  if (!input.impact || input.busy) return false
  return input.impact.canDelete && input.impact.blockers.length === 0
}

/**
 * 409 の返事に入っている最新の影響を、型を確かめて取り出す。
 *
 * **消せると出したまま失敗を出さない。** 削除の直前に状態が変わると
 * Workerは409と一緒に**その時点の影響**を返す。古い「消せます」を
 * 窓に残したままにすると、何が変わったのか読めない。
 *
 * `unknown` を素通ししない——形が違うものを入れると、次の描画で落ちる。
 */
export function impactFromError(data: unknown): RichMenuDeleteImpact | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  const body = (typeof raw.data === 'object' && raw.data !== null ? raw.data : raw) as Record<string, unknown>
  if (typeof body.canDelete !== 'boolean') return null
  if (!Array.isArray(body.blockers)) return null
  if (typeof body.group !== 'object' || body.group === null) return null
  if (typeof body.nextDisplay !== 'object' || body.nextDisplay === null) return null
  if (!Array.isArray(body.incomingSwitches) || !Array.isArray(body.operationalReferences)) return null
  return body as unknown as RichMenuDeleteImpact
}
