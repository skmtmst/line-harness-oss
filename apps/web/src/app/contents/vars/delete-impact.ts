import type { CommonVarDeleteImpact, CommonVarDeleteImpactItem } from '@line-crm/shared'

/**
 * 共通情報を消したときの影響（設計 `yPkWe` 14-1-C／契約 #611）。
 *
 * **消すと、差し込んでいた場所が空欄のまま送られる。** 「ご不明な点は
 * までお気軽にどうぞ。」のような文になる。何か所でそれが起きるのかを、
 * 押す前に言う。
 */

/** 取得元が無い値。実値の0とは別。 */
export const NOT_AVAILABLE = '—（未取得）'

/**
 * 差し込みキーの見せ方。
 *
 * **一覧と同じ `{{var.キー}}` の形にする。** 一覧では
 * `{{var.shop_hours}}` と出しているので、確認だけ `{shop_hours}` に
 * すると、どちらを打てばよいのか分からない（設計は `{会社名}` と
 * 書いているが、実装が本文で使っている形はこちら）。
 */
export function placeholderText(varKey: string): string {
  return `{{var.${varKey}}}`
}

/**
 * 何か所で使われているか。
 *
 * **0か所は「どこにも差し込まれていません」。** 未取得と混ぜない。
 */
export function usageText(impact: CommonVarDeleteImpact): string {
  if (impact.total === 0) return 'どこにも差し込まれていません。'
  return `${placeholderText(impact.variable.varKey)} は ${impact.total.toLocaleString('ja-JP')}か所で差し込まれています。`
}

/**
 * 消したときに起きること。
 *
 * **「消えます」ではなく「空欄のまま送られます」。** 差し込みが消えても
 * 文そのものは送られ続けるので、そこが伝わらないと危ない。
 */
export function consequenceText(impact: CommonVarDeleteImpact): string | null {
  if (impact.total === 0) return null
  return `削除すると、その${impact.total.toLocaleString('ja-JP')}か所の `
    + `${placeholderText(impact.variable.varKey)} は空欄のまま送られます。`
}

/**
 * 使用先を、消せなくする分と履歴だけの分に分ける。
 *
 * **送信済みの配信は消せない理由にならない。** もう送ったものなので、
 * これから変わることは無い。同じ一覧に混ぜると「なぜ消せないのか」が
 * 読めなくなる。
 */
export function splitItems(items: CommonVarDeleteImpactItem[]): {
  blocking: CommonVarDeleteImpactItem[]
  historical: CommonVarDeleteImpactItem[]
} {
  return {
    blocking: items.filter((item) => item.blocksDeletion),
    historical: items.filter((item) => !item.blocksDeletion),
  }
}

/** 見せられない使用先。**件数を隠さない。** 名前だけ出せないと言う。 */
export function unavailableText(impact: CommonVarDeleteImpact): string | null {
  if (impact.unavailableReferences.length === 0) return null
  return impact.unavailableReferences
    .map((ref) => `${ref.kindLabel}${ref.count.toLocaleString('ja-JP')}件（${ref.reason}）`)
    .join('／')
}

/**
 * 消してよいか。
 *
 * **差し込みキーを打ってもらう。** 空欄のまま送られる場所がある操作を、
 * ボタン1つで通さない。取り消せないので、対象を取り違えたまま押せる形に
 * しない。
 */
export function canDelete(input: {
  impact: CommonVarDeleteImpact | null
  typedKey: string
  busy: boolean
}): boolean {
  const impact = input.impact
  if (!impact || input.busy) return false
  if (!impact.canDelete) return false
  return input.typedKey.trim() === placeholderText(impact.variable.varKey)
}

/** 押せない理由。**押せないボタンを黙って出さない。** */
export function blockedReason(input: {
  impact: CommonVarDeleteImpact | null
  typedKey: string
}): string | null {
  const impact = input.impact
  if (!impact) return '使用先をまだ読み込めていません。'
  if (!impact.canDelete) {
    return `${impact.blockingTotal.toLocaleString('ja-JP')}か所で使われているあいだは削除できません。`
      + '使用先から外してから、もう一度お試しください。'
  }
  if (input.typedKey.trim() !== placeholderText(impact.variable.varKey)) {
    return `確認のため ${placeholderText(impact.variable.varKey)} を入力してください。`
  }
  return null
}

/** 確かめた時刻。「いつ時点の話か」が無いと、消す判断ができない。 */
export function checkedAtText(checkedAt: string): string {
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
  }).format(date)
}
