import { isRuleComplete, type SegmentCondition } from '@/lib/segment-condition'

/**
 * 通の一覧に出す言葉（設計 `bV5Vs` の「配信対象」「送信後」の列）。
 *
 * **`—` は未取得のときだけ。** 実装は `afterSend: 'continue'` を `—` と
 * 描いていた。`continue` は「次へ進む」という**決まっている値**で、
 * 取れていないわけではない。`—` にすると、決めていないのか読めていないのか
 * 見分けられなくなる。
 */

export const NOT_AVAILABLE = '—'

export function afterSendText(afterSend: 'continue' | 'pause' | null | undefined): string {
  if (afterSend === 'pause') return '返信まで一時停止'
  if (afterSend === 'continue') return '次へ進む'
  return NOT_AVAILABLE
}

/** 一時停止だけ色を変える。**進むのがふつうで、止まるほうが目立つべき。** */
export function afterSendIsPause(afterSend: 'continue' | 'pause' | null | undefined): boolean {
  return afterSend === 'pause'
}

/**
 * 1通ごとの配信対象。**`null` は「購読中の全員」。** 未取得ではない。
 *
 * 書きかけの行は数えない。数に入れると、保存していない行のぶんだけ
 * 「条件2件」と出て、実際に効いている数と食い違う。
 *
 * タグ1つだけで絞っているときは、設計どおり「タグ：初回案内」と名前で言う。
 * **名前が引けないときは件数で言う。** 内部IDを画面へ出さない。
 */
export function stepTargetText(
  condition: SegmentCondition | null | undefined,
  tagNameOf: (id: string) => string | undefined = () => undefined,
): string {
  if (condition === undefined) return NOT_AVAILABLE
  if (condition === null) return '購読中の全員'
  const count = countRules(condition)
  if (count === 0) return '購読中の全員'
  if ((condition.groups ?? []).length === 0) {
    const rules = condition.rules.filter(isRuleComplete)
    if (rules.length === 1 && rules[0].type === 'tag_exists' && typeof rules[0].value === 'string') {
      const name = tagNameOf(rules[0].value)
      if (name) return `タグ：${name}`
    }
  }
  return `条件 ${count}件`
}

function countRules(condition: SegmentCondition): number {
  const own = condition.rules.filter(isRuleComplete).length
  const nested = (condition.groups ?? []).reduce((sum, group) => sum + countRules(group), 0)
  return own + nested
}
