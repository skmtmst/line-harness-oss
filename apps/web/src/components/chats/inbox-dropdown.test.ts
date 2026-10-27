import { describe, expect, it } from 'vitest'

import { buildOperatorRows } from './inbox-dropdown'

const OPERATORS = [
  { id: 'operator-1', name: '河野 健太' },
  { id: 'operator-2', name: '佐々木 花子' },
]

describe('受信箱の担当者候補', () => {
  it('一覧を絞り込むときは「すべて」と未割り当てを選べる', () => {
    expect(buildOperatorRows(OPERATORS, true).map((row) => row.id)).toEqual([
      'all',
      'unassigned',
      'operator-1',
      'operator-2',
    ])
  })

  it('担当者を変更するときは「すべて」を候補に入れない', () => {
    const rows = buildOperatorRows(OPERATORS, false, 'operator-2')

    expect(rows.map((row) => row.id)).toEqual(['operator-2', 'operator-1', 'unassigned'])
    expect(rows.some((row) => row.id === 'all')).toBe(false)
  })

  it('APIの順ではなく名前順で並べる', () => {
    const reversed = [...OPERATORS].reverse()
    expect(buildOperatorRows(reversed, true).map((row) => row.name)).toEqual([
      'すべて',
      '未割り当て',
      '河野 健太',
      '佐々木 花子',
    ])
  })

})
