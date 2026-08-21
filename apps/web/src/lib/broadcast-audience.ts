/*
 * 一斉配信の「誰に送るか」を、そのまま送信に使える条件の形に組み立てる。
 *
 * 画面から切り出してあるのは、ここが**間違えても画面では気づけない**ため。
 * 条件が壊れていても入力欄は普通に見え、送ってはじめて「誰にも届かない」
 * か「全員に届いた」かが分かる。
 *
 * 実際に壊れていた: 「詳細条件」の 性別・年代・エリア・友だち期間・過去反応 は
 * `friends.metadata` の `$.gender` などを見ていたが、そこに値を書く経路が
 * どこにも無かった。選んでも常に0人で、しかも0人と表示されるだけなので
 * 「まだ該当者がいない」と読めてしまう。項目ごと捨てて、シナリオと同じ
 * 条件ビルダー（15項目・and/or）に寄せた。
 */

import { pruneCondition, type SegmentCondition } from './segment-condition'

/** 送る相手の決め方。 */
export type TargetMode = 'all' | 'scenario' | 'tag' | 'advanced'

export const TARGET_MODES: Array<{ value: TargetMode; label: string; description: string }> = [
  {
    value: 'all',
    label: '友だち全員に配信する',
    description: 'ブロック中の人を除いた全員',
  },
  {
    value: 'scenario',
    label: 'シナリオ購読中の全員に配信する',
    description: 'いまシナリオが流れている人。止まっている人・配信し終わった人は入りません',
  },
  {
    value: 'tag',
    label: 'タグで絞り込んで配信する',
    description: '選んだタグが付いている人',
  },
  {
    value: 'advanced',
    label: '詳細条件で絞り込んで配信する',
    description: 'シナリオと同じ条件（タグ・友だち情報・登録日・反応状態など）で絞ります',
  },
]

export interface AudienceInput {
  /** 空なら「どれか1つでも購読中」。 */
  scenarioId: string
  tagId: string
  condition: SegmentCondition | null
}

/**
 * 送信にも人数の数え上げにも使う、ひとつの条件。
 *
 * どのやり方を選んでも `is_following` を必ず入れる。ブロック中の人へ送ると
 * LINE がエラーを返し、その分だけ配信数が減って見える。
 */
export function buildAudienceCondition(mode: TargetMode, input: AudienceInput): SegmentCondition {
  const base: SegmentCondition = {
    operator: 'AND',
    rules: [{ type: 'is_following', value: true }],
    groups: [],
  }

  if (mode === 'scenario') {
    base.rules.push({ type: 'scenario_subscribed', value: input.scenarioId })
    return base
  }

  if (mode === 'tag') {
    if (input.tagId) base.rules.push({ type: 'tag_exists', value: input.tagId })
    return base
  }

  if (mode === 'advanced') {
    // 書きかけの行は落とす。残すと worker が読めない条件として断る。
    const usable = pruneCondition(input.condition)
    if (usable) {
      base.rules.push(...usable.rules)
      base.groups = [...(usable.groups ?? [])]
    }
    return base
  }

  return base
}

/**
 * このまま保存してよいか。だめなら理由を返す。
 *
 * 「詳細条件」を選んだのに条件が空だと、`is_following` だけが残って
 * **全員に届く**。絞ったつもりで全員に送るのがいちばん困るので止める。
 * 全員に送りたいときは「友だち全員に配信する」を選ぶ。
 */
export function audienceError(mode: TargetMode, input: AudienceInput): string {
  if (mode === 'tag' && !input.tagId) return '送る相手のタグを選んでください'
  if (mode === 'advanced' && !pruneCondition(input.condition)) {
    return '詳細条件を1つ以上入力してください。全員に送るなら「友だち全員に配信する」を選んでください'
  }
  return ''
}

/** 一覧や確認に出す、条件の要約。 */
export function describeAudience(
  mode: TargetMode,
  input: AudienceInput,
  names: { scenarios: Array<{ id: string; name: string }>; tags: Array<{ id: string; name: string }> },
): string {
  if (mode === 'all') return '友だち全員（ブロック中を除く）'
  if (mode === 'scenario') {
    if (!input.scenarioId) return 'シナリオ購読中の全員'
    const found = names.scenarios.find((s) => s.id === input.scenarioId)
    return `「${found?.name ?? '不明なシナリオ'}」を購読中の人`
  }
  if (mode === 'tag') {
    const found = names.tags.find((t) => t.id === input.tagId)
    return found ? `タグ「${found.name}」が付いている人` : 'タグ未選択'
  }
  const usable = pruneCondition(input.condition)
  if (!usable) return '詳細条件（未入力）'
  const count = usable.rules.length + (usable.groups ?? []).reduce((n, g) => n + g.rules.length, 0)
  return `詳細条件 ${count} 件`
}
