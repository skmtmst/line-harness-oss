import { describe, expect, test } from 'vitest'
import { mergeOrderedActions, stepNumbers } from './action-order'
import type { CommonActionStep } from '@/lib/api'

const wait = (id: string, minutes = 5): CommonActionStep => ({
  id, type: 'wait', params: { durationMinutes: minutes }, onFailure: 'stop',
})
const branch = (id: string): CommonActionStep => ({
  id,
  type: 'branch',
  params: {
    condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
    then: [],
    else: [],
  },
  onFailure: 'stop',
})

/*
 * 監査 R474: 待ち時間の編集だけで途中の分岐が末尾へ移動しない。
 * 画面番号・保存JSON・再読込の順番が一致する。
 */
describe('mergeOrderedActions（監査 R474）', () => {
  test('値だけの変更ではID順を保持する', () => {
    const current = [wait('first', 5), branch('b'), wait('last', 5)]
    const next = [wait('first', 10), wait('last', 5)]
    const merged = mergeOrderedActions(current, next)
    expect(merged.map((step) => step.id)).toEqual(['first', 'b', 'last'])
    expect(merged[0].params).toEqual({ durationMinutes: 10 })
  })

  test('削除は詰めて分岐の相対位置を保つ', () => {
    const current = [wait('first'), wait('second'), branch('b'), wait('last')]
    const merged = mergeOrderedActions(current, [wait('first'), wait('last')])
    expect(merged.map((step) => step.id)).toEqual(['first', 'last', 'b'])
  })

  test('追加は末尾へ、分岐自体は触らない', () => {
    const current = [wait('first'), branch('b')]
    const merged = mergeOrderedActions(current, [wait('first'), wait('added')])
    expect(merged.map((step) => step.id)).toEqual(['first', 'b', 'added'])
    expect(merged[1]).toBe(current[1])
  })

  test('全体の番号表は実行順と一致する', () => {
    expect(stepNumbers([wait('first'), branch('b'), wait('last')])).toEqual({
      first: 1, b: 2, last: 3,
    })
  })
})
