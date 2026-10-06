import { describe, expect, it } from 'vitest'
import { moveTargetingGroup, orderTargetingGroups, withNormalizedPriority } from './targeting-order'

const GROUPS = [
  { id: 'later-created', targetingPriority: 0, createdAt: '2026-08-02T00:00:00.000Z' },
  { id: 'first', targetingPriority: 0, createdAt: '2026-08-01T00:00:00.000Z' },
  { id: 'third', targetingPriority: 9, createdAt: '2026-08-03T00:00:00.000Z' },
]

describe('リッチメニューの出す順番', () => {
  it('同じ優先番号は作成順で安定させ、元の配列を壊さない', () => {
    expect(orderTargetingGroups(GROUPS).map((group) => group.id)).toEqual([
      'first',
      'later-created',
      'third',
    ])
    expect(GROUPS.map((group) => group.id)).toEqual(['later-created', 'first', 'third'])
  })

  it('上下移動後は古い同順位を残さず0,1,2へそろえる', () => {
    expect(moveTargetingGroup(GROUPS, 'first', 1)).toEqual([
      { id: 'later-created', priority: 0 },
      { id: 'first', priority: 1 },
      { id: 'third', priority: 2 },
    ])
  })

  it('先頭を上、末尾を下へ動かす操作は書き込み対象を返さない', () => {
    expect(moveTargetingGroup(GROUPS, 'first', -1)).toBeNull()
    expect(moveTargetingGroup(GROUPS, 'third', 1)).toBeNull()
  })

  it('先行反映はIDの順に並べ、番号を振り直して元の配列を壊さない', () => {
    const next = withNormalizedPriority(GROUPS, ['third', 'first', 'later-created'])
    expect(next.map((group) => group.id)).toEqual(['third', 'first', 'later-created'])
    expect(next.map((group) => group.targetingPriority)).toEqual([0, 1, 2])
    expect(GROUPS.map((group) => group.targetingPriority)).toEqual([0, 0, 9])
  })

  it('先行反映は知らないIDを飛ばす', () => {
    expect(withNormalizedPriority(GROUPS, ['first', 'gone']).map((group) => group.id)).toEqual(['first'])
  })
})
