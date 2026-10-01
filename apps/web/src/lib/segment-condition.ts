/*
 * 友だちの絞り込み条件の「形」と、その扱い。
 *
 * 画面の部品（condition-builder.tsx）から切り出してある。同じ形を
 * シナリオ・1通ごとの配信対象・アクションの実行条件・一斉配信の宛先が
 * 使うので、React に依らない場所に置いて、そこだけを試験できるようにする。
 *
 * 形は worker の `SegmentCondition` と同じ。画面側で別の形にして変換すると、
 * 項目を増やすたびに2か所直すことになり、必ずどちらかがずれる。
 */

export type FieldOperator =
  | 'equals'
  | 'contains'
  | 'exists'
  | 'not_exists'
  | 'not_equals'
  | 'not_contains'
  | 'gte'
  | 'gt'
  | 'lte'
  | 'lt'

export interface SegmentRule {
  type: string
  value: unknown
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
  groups?: SegmentCondition[]
}

/**
 * まだ書きかけの行か。
 *
 * タグを選ぶ前、項目を選ぶ前の行を数え上げに送ると、worker が
 * 「読めない条件」として断る。件数が出ないだけならまだしも、そのまま
 * 保存すると**誰にも届かない条件**が出来上がる。書けている行だけを使う。
 */
export function isRuleComplete(rule: SegmentRule): boolean {
  const v = rule.value as Record<string, unknown>
  switch (rule.type) {
    case 'tag_exists':
    case 'tag_not_exists':
      return typeof rule.value === 'string' && rule.value !== ''
    case 'tag_all':
    case 'tag_not_all':
      return Array.isArray(rule.value) && rule.value.length > 0
    case 'name':
      return typeof v?.text === 'string' && v.text.trim() !== ''
    case 'private_memo':
    case 'status_message':
    case 'ref_code':
      return typeof rule.value === 'string' && rule.value.trim() !== ''
    case 'registered_at':
    case 'last_reaction_at':
      return (
        (typeof v?.from === 'string' && v.from !== '') ||
        (typeof v?.to === 'string' && v.to !== '')
      )
    case 'support_mark':
      return Array.isArray(v?.markIds) && (v.markIds as unknown[]).length > 0
    case 'friend_field':
      return typeof v?.fieldId === 'string' && v.fieldId !== ''
    case 'scenario_state':
      return typeof v?.scenarioId === 'string' && v.scenarioId !== ''
    case 'analytics_audience':
      // 分析画面から渡された一時対象者。audienceId が空なら書きかけと同じく落とす。
      return typeof v?.audienceId === 'string' && v.audienceId !== ''
    case 'broadcast_link_clicked':
      // 配信詳細の追送で渡す条件。broadcastId が無いと「全員」として数えられるので必須。
      return typeof v?.broadcastId === 'string' && v.broadcastId !== ''
    case 'scenario_subscribed':
      return typeof rule.value === 'string' && rule.value !== ''
    case 'score_range': {
      const minProvided = v?.min !== null && v?.min !== undefined && v.min !== ''
      const maxProvided = v?.max !== null && v?.max !== undefined && v.max !== ''
      if ((minProvided && !Number.isSafeInteger(v.min)) || (maxProvided && !Number.isSafeInteger(v.max))) {
        return false
      }
      const min = Number.isSafeInteger(v?.min) ? v.min as number : null
      const max = Number.isSafeInteger(v?.max) ? v.max as number : null
      return (min !== null || max !== null) && (min === null || max === null || min <= max)
    }
    default:
      // form_answered は空で「どれかに回答した人」、is_following /
      // is_hidden / reaction_state は常に値が入っている。
      return true
  }
}

/*
 * R247: 入力済みだが不正な数値範囲（上下限の逆転・非整数）を見つける。
 * `isRuleComplete` はこれを一律「書きかけ」として落とすため、そのまま
 * 保存すると絞り込みが黙って外れる（対象が広がる）。編集中の空行とは分け、
 * 両欄の近くに理由を示して保存を止めるために使う。なければ null。
 */
export function findInvalidRangeIssue(condition: SegmentCondition | null): string | null {
  if (!condition) return null
  const checkRule = (rule: SegmentRule): string | null => {
    if (rule.type !== 'score_range') return null
    const v = rule.value as { min?: unknown; max?: unknown } | null | undefined
    const min = v?.min ?? null
    const max = v?.max ?? null
    if (min === null || min === undefined || min === '' || max === null || max === undefined || max === '') {
      return null
    }
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      return '行動スコアは整数で入力してください。'
    }
    if ((min as number) > (max as number)) {
      return '行動スコアの上限が下限を下回っています。下限と上限を見直してください。'
    }
    return null
  }
  for (const rule of condition.rules ?? []) {
    const issue = checkRule(rule)
    if (issue) return issue
  }
  for (const group of condition.groups ?? []) {
    for (const rule of group.rules ?? []) {
      const issue = checkRule(rule)
      if (issue) return issue
    }
  }
  return null
}

/** 書きかけの行を落とす。保存にも数え上げにも同じものを使う。 */
export function pruneCondition(condition: SegmentCondition | null): SegmentCondition | null {
  if (!condition) return null
  const rules = (condition.rules ?? []).filter(isRuleComplete)
  const groups = (condition.groups ?? [])
    .map((g) => pruneCondition(g))
    .filter((g): g is SegmentCondition => g !== null)
  if (rules.length === 0 && groups.length === 0) return null
  return { operator: condition.operator, rules, groups }
}

/** 条件が実質空か。空なら null として保存し、「絞り込みなし」の意味にする。 */
export function isEmptyCondition(condition: SegmentCondition | null): boolean {
  if (!condition) return true
  const groupCount = (condition.groups ?? []).filter(
    (g) => g.rules.length > 0 || (g.groups?.length ?? 0) > 0,
  ).length
  return condition.rules.length === 0 && groupCount === 0
}

/*
 * S4-OR: 何も足していない素の空か。足したばかりの空のかたまりは
 * 下書きとして残すため、実質空（isEmptyCondition）とは分けて見る。
 * 素の空のときだけ null へ戻し、編集中の表示を消さない。
 */
export function isStructurallyEmpty(condition: SegmentCondition | null): boolean {
  if (!condition) return true
  return (condition.rules ?? []).length === 0 && (condition.groups ?? []).length === 0
}

/*
 * R243/S4-OR: 編集中の下書きに不足があるか。保存のときに案内するために使う。
 * 実質空（isEmptyCondition）は「絞り込みなし」として有効なので案内しない。
 * 空の「いずれか」のかたまり・未完成の行があるときだけ文を返す。
 * 保存側は pruneCondition で整えるので、ここでは値を変えない。
 */
export function findConditionDraftIssue(draft: SegmentCondition | null): string | null {
  /*
   * 素の空（null・行もかたまりも無し）は「絞り込みなし」として有効。
   * 空のかたまりだけの下書きは実質空でも、足すつもりの条件が無い
   * ままなので「広い一致」へ黙って落ちないよう案内する。
   */
  if (!draft || isStructurallyEmpty(draft)) return null
  const hasIncompleteRule = (rules: SegmentRule[]) => rules.some((rule) => !isRuleComplete(rule))
  if (hasIncompleteRule(draft.rules ?? [])) {
    return '入力が未完成の条件があります。空欄を埋めるか、「この条件を外す」で取り除いてください。'
  }
  const checkGroups = (groups: SegmentCondition[]): string | null => {
    for (const group of groups ?? []) {
      if ((group.rules ?? []).length === 0 && (group.groups ?? []).length === 0) {
        return '空の「いずれか」の条件のかたまりがあります。項目を足すか、かたまりを外してください。'
      }
      if (hasIncompleteRule(group.rules ?? [])) {
        return '入力が未完成の条件があります。空欄を埋めるか、「この条件を外す」で取り除いてください。'
      }
      const nested = checkGroups(group.groups ?? [])
      if (nested) return nested
    }
    return null
  }
  return checkGroups(draft.groups ?? [])
}
