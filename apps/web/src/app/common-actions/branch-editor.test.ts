import { describe, expect, test } from 'vitest'
import { newBranchStep, updateBranchStep } from './branch-editor'
import type { CommonActionStep } from '@/lib/api'

const refStep = (id: string, commonActionId: string): CommonActionStep => ({
  id, type: 'common_action', params: { commonActionId }, onFailure: 'stop',
})
const waitStep = (id: string, minutes: number): CommonActionStep => ({
  id, type: 'wait', params: { durationMinutes: minutes }, onFailure: 'stop',
})

/* 監査の再現構造：ORの2条件、当てはまる側3処理・当てはまらない側2処理。 */
const complexBranch = (): CommonActionStep => ({
  ...newBranchStep(),
  id: 'branch-1',
  params: {
    condition: {
      operator: 'OR',
      rules: [
        { type: 'tag_exists', value: 'tag-1' },
        { type: 'tag_exists', value: 'tag-2' },
      ],
    },
    then: [refStep('yes-1', 'ca-a'), refStep('yes-2', 'ca-b'), refStep('yes-3', 'ca-c')],
    else: [waitStep('no-1', 5), waitStep('no-2', 10)],
  },
})

const conditionOf = (step: CommonActionStep) => step.params.condition as {
  operator: string
  rules: Array<{ type: string; value: string }>
}
const thenOf = (step: CommonActionStep) => step.params.then as CommonActionStep[]
const elseOf = (step: CommonActionStep) => step.params.else as CommonActionStep[]

/*
 * 監査 R476: 分岐の編集で画面に出ない条件と後続の子処理が消える。
 * 1項目の変更で他項目・演算子・順序が保持される。
 */
describe('updateBranchStep（監査 R476）', () => {
  test('タグだけ変えてもOR・2条件・全子処理が残る', () => {
    const next = updateBranchStep(complexBranch(), { kind: 'ruleTag', ruleIndex: 0, tagId: 'tag-9' })
    expect(conditionOf(next)).toEqual({
      operator: 'OR',
      rules: [
        { type: 'tag_exists', value: 'tag-9' },
        { type: 'tag_exists', value: 'tag-2' },
      ],
    })
    expect(thenOf(next).map((step) => step.id)).toEqual(['yes-1', 'yes-2', 'yes-3'])
    expect(elseOf(next).map((step) => step.id)).toEqual(['no-1', 'no-2'])
  })

  test('当てはまる側の1件を変えても他の2件と反対側が残る', () => {
    const next = updateBranchStep(complexBranch(), {
      kind: 'sideAction', side: 'then', stepIndex: 1, commonActionId: 'ca-z',
    })
    expect(thenOf(next).map((step) => step.params.commonActionId)).toEqual(['ca-a', 'ca-z', 'ca-c'])
    expect(elseOf(next)).toHaveLength(2)
    expect(conditionOf(next).operator).toBe('OR')
  })

  test('当てはまらない側の表示外の処理は選択変更で消えない', () => {
    // else側は待ち時間（読み取り専用）。参照の変更対象が無ければ何も変えない。
    const before = complexBranch()
    const next = updateBranchStep(before, {
      kind: 'sideAction', side: 'else', stepIndex: 0, commonActionId: 'ca-z',
    })
    expect(next).toEqual(before)
    expect(elseOf(next)).toHaveLength(2)
  })

  test('演算子・条件・子処理の追加と削除は対象だけ変わる', () => {
    const toggled = updateBranchStep(complexBranch(), { kind: 'operator', operator: 'AND' })
    expect(conditionOf(toggled).operator).toBe('AND')
    expect(conditionOf(toggled).rules).toHaveLength(2)

    const added = updateBranchStep(toggled, { kind: 'ruleAdd' })
    expect(conditionOf(added).rules).toHaveLength(3)

    const removed = updateBranchStep(added, { kind: 'ruleRemove', ruleIndex: 2 })
    expect(conditionOf(removed).rules).toHaveLength(2)

    // 最後の1件は外せない（空の条件・空の側を保存させない）。
    const lastRule = updateBranchStep(
      { ...complexBranch(), params: { ...(complexBranch().params), condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] } } },
      { kind: 'ruleRemove', ruleIndex: 0 },
    )
    expect(conditionOf(lastRule).rules).toHaveLength(1)
  })

  test('分岐以外には何もしない', () => {
    const plain = waitStep('w', 5)
    expect(updateBranchStep(plain, { kind: 'ruleAdd' })).toBe(plain)
  })
})
