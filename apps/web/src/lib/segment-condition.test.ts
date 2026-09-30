import { describe, expect, it } from 'vitest'
import {
  findConditionDraftIssue,
  isEmptyCondition,
  isStructurallyEmpty,
  isRuleComplete,
  pruneCondition,
} from './segment-condition'

describe('行動スコアの共通絞り込み', () => {
  it('片側だけの整数境界を受け入れる', () => {
    expect(isRuleComplete({ type: 'score_range', value: { min: 70, max: null } })).toBe(true)
    expect(isRuleComplete({ type: 'score_range', value: { min: null, max: 29 } })).toBe(true)
  })

  it('空・小数・上下逆転を保存対象から外す', () => {
    expect(isRuleComplete({ type: 'score_range', value: { min: null, max: null } })).toBe(false)
    expect(isRuleComplete({ type: 'score_range', value: { min: 1.5, max: 29 } })).toBe(false)
    expect(isRuleComplete({ type: 'score_range', value: { min: 70, max: 30 } })).toBe(false)
    expect(pruneCondition({
      operator: 'AND',
      rules: [{ type: 'score_range', value: { min: 70, max: 30 } }],
    })).toBeNull()
  })
})

describe('シナリオ購読の共通絞り込み', () => {
  it('シナリオを選ぶ前は保存せず、選択後だけ保存する', () => {
    expect(isRuleComplete({ type: 'scenario_subscribed', value: '' })).toBe(false)
    expect(isRuleComplete({ type: 'scenario_subscribed', value: 'scenario-1' })).toBe(true)
  })
})

/*
 * S4-OR: 空のかたまりは「下書き」として残るが、保存の意味は「絞り込みなし」。
 * 中身のある入れ子は支える（保存に残る）。空のまま広い一致へ黙って
 * 落とさないよう、下書きの不足は保存時に案内する。
 */
describe('S4-OR 空のかたまりと中身のある入れ子', () => {
  const emptyGroup = { operator: 'OR' as const, rules: [] }
  const scoreRule = { type: 'score_range', value: { min: 30, max: 69 } }

  it('素の空と実質空を見分ける', () => {
    expect(isStructurallyEmpty(null)).toBe(true)
    expect(isStructurallyEmpty({ operator: 'AND', rules: [] })).toBe(true)
    // 空のかたまりを足した下書きは、素の空ではない（編集表示を残す）。
    expect(isStructurallyEmpty({ operator: 'AND', rules: [], groups: [emptyGroup] })).toBe(false)
    // 実質空としては「絞り込みなし」と同じ（保存・数え上げの意味）。
    expect(isEmptyCondition({ operator: 'AND', rules: [], groups: [emptyGroup] })).toBe(true)
    expect(isEmptyCondition({ operator: 'AND', rules: [scoreRule], groups: [emptyGroup] })).toBe(false)
  })

  it('中身のある入れ子は保存に残し、空のかたまりは落とす', () => {
    // 支える入れ子：中身のある or かたまりは残る。
    expect(
      pruneCondition({ operator: 'AND', rules: [], groups: [{ ...emptyGroup, rules: [scoreRule] }] }),
    ).toEqual({ operator: 'AND', rules: [], groups: [{ operator: 'OR', rules: [scoreRule], groups: [] }] })
    // 空のかたまりだけの下書きは null（＝全員対象）になる。黙って保存せず案内する。
    expect(pruneCondition({ operator: 'AND', rules: [], groups: [emptyGroup] })).toBeNull()
  })

  it('下書きの不足は保存時に案内する（空のまま通さない）', () => {
    expect(findConditionDraftIssue(null)).toBeNull()
    expect(findConditionDraftIssue({ operator: 'AND', rules: [] })).toBeNull()
    // 空のかたまりだけでも案内する（広い一致へ黙って落ちない）。
    expect(
      findConditionDraftIssue({ operator: 'AND', rules: [], groups: [emptyGroup] }),
    ).toContain('空の')
    expect(
      findConditionDraftIssue({ operator: 'AND', rules: [scoreRule], groups: [emptyGroup] }),
    ).toContain('空の')
    // 未完成の行も案内する。
    expect(
      findConditionDraftIssue({
        operator: 'AND',
        rules: [{ type: 'tag_exists', value: '' }],
      }),
    ).toContain('未完成')
    // 入れ子の奥の不足も見つける。完成した入れ子は通す。
    expect(
      findConditionDraftIssue({
        operator: 'AND',
        rules: [],
        groups: [{ operator: 'OR', rules: [], groups: [emptyGroup] }],
      }),
    ).toContain('空の')
    expect(
      findConditionDraftIssue({
        operator: 'AND',
        rules: [],
        groups: [{ ...emptyGroup, rules: [scoreRule] }],
      }),
    ).toBeNull()
  })
})
