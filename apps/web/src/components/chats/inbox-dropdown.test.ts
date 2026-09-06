import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildOperatorRows } from './inbox-dropdown'

const DROPDOWN = readFileSync(join(__dirname, 'inbox-dropdown.tsx'), 'utf8')

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

  it('担当者は顔の印と名前を並べる', () => {
    expect(DROPDOWN).toContain('<OperatorMark option={row} />')
    expect(DROPDOWN).toContain("Array.from(option.name.trim())[0]")
  })

  it('未読数を取得できない理由と次の行動を本文に出す', () => {
    expect(DROPDOWN).toContain('未読の数をいま数えられません')
    expect(DROPDOWN).toContain('0件とは違います。少し待ってからもう一度開いてください。')
    expect(DROPDOWN).toContain('border-warning bg-warning-bg')
  })
})
