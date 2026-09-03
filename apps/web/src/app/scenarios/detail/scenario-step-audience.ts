/*
 * コンテンツ表の「配信対象」の桁に出す1行。
 *
 * 設計（bV5Vs）は通ごとに配る相手を桁で見せる。実装は絞り込みを通の編集を
 * 開かないと読めず、**表からは「誰に送る通なのか」が分からなかった**。
 * 通が増えるほど、全員向けと絞り込み済みの通が見分けられなくなる。
 *
 * 決まりごと：
 *   - 絞り込みが無い通は `—` ではない。「購読中の全員」という**決まっている値**。
 *   - タグ1つだけの絞り込みは、タグの名前で言う。
 *   - 名前が引けないタグは**件数で言う**。内部IDは画面に出さない。
 *   - 書きかけの行は数えない（保存前の行が件数に混ざると数が食い違う）。
 */

import {
  isEmptyCondition,
  pruneCondition,
  type SegmentCondition,
} from '@/lib/segment-condition'

export interface AudienceTagName {
  id: string
  name: string
}

/** タグ1つだけの絞り込みなら、そのタグIDを返す。 */
function soleTagId(condition: SegmentCondition): string | null {
  if ((condition.groups ?? []).some((g) => g.rules.length > 0)) return null
  if (condition.rules.length !== 1) return null
  const rule = condition.rules[0]
  if (rule.type !== 'tag_exists') return null
  return typeof rule.value === 'string' && rule.value !== '' ? rule.value : null
}

/**
 * 保存されている値が条件の形をしているか。
 *
 * `targetCondition` は `unknown` で来る（DBのJSON列そのまま）。形が違う古い
 * 行を素通しすると `rules.filter is not a function` で**画面ごと落ちる**。
 * 読めない値は「絞り込みなし」として扱い、落とさない。
 */
function asCondition(raw: unknown): SegmentCondition | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<SegmentCondition>
  if (!Array.isArray(value.rules)) return null
  if (value.groups !== undefined && !Array.isArray(value.groups)) return null
  return {
    operator: value.operator === 'OR' ? 'OR' : 'AND',
    rules: value.rules,
    groups: (value.groups ?? [])
      .map((g) => asCondition(g))
      .filter((g): g is SegmentCondition => g !== null),
  }
}

/**
 * 1通の配信対象を1行で言い表す。
 *
 * `tags` に名前が無いタグ（消された・別アカウントのもの）は、IDを出さずに
 * 件数の言い方へ落とす。
 */
export function describeStepAudience(
  raw: unknown,
  tags: readonly AudienceTagName[],
): string {
  const condition = pruneCondition(asCondition(raw))
  if (isEmptyCondition(condition)) return '購読中の全員'

  const tagId = soleTagId(condition!)
  if (tagId) {
    const name = tags.find((t) => t.id === tagId)?.name
    if (name) return `タグ：${name}`
  }

  const rules = condition!.rules.length
  const groups = (condition!.groups ?? []).filter((g) => g.rules.length > 0).length
  return groups === 0 ? `詳細条件 ${rules}件` : `詳細条件 ${rules}件 ＋ or条件 ${groups}組`
}

/**
 * 送ったあとどうするか、を1行で言い表す。
 *
 * 既定の `continue` は**決まっている値**なので `—` にしない。`—` は
 * 「取れていない」の印で、そこに既定値を混ぜると読み手が区別できなくなる。
 */
export function describeAfterSend(afterSend: 'continue' | 'pause' | undefined): {
  label: string
  paused: boolean
} {
  return afterSend === 'pause'
    ? { label: '返信まで一時停止', paused: true }
    : { label: '次へ進む', paused: false }
}
