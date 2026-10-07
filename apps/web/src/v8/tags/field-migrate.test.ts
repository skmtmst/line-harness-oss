import { describe, expect, it } from 'vitest'
import type { FriendFieldMigrationPreview } from '@/lib/api'
import { sampleRows } from './field-migrate'

const preview = (rows: FriendFieldMigrationPreview['rows'], convertible: number) => ({
  summary: { total: rows.length + convertible, convertible, review: rows.length, invalid: 0 },
  rows,
}) as FriendFieldMigrationPreview

describe('移行の見本の表（GobMd）', () => {
  it('同じ「今の値 → 移したあと」をまとめて人数を数え、そのまま移せる人数を先頭に置く', () => {
    const rows = sampleRows(preview([
      { friendId: 'a', sourceValue: 'ポチ', convertedValue: 'ポチ（選ぶ候補に足す）', status: 'review', reason: null },
      { friendId: 'b', sourceValue: 'ポチ', convertedValue: 'ポチ（選ぶ候補に足す）', status: 'review', reason: null },
      { friendId: 'c', sourceValue: '', convertedValue: null, status: 'invalid', reason: '値が空欄です' },
    ], 5))
    expect(rows).toEqual([
      { from: 'そのまま移せる値', to: '同じ値', count: 5 },
      { from: 'ポチ', to: 'ポチ（選ぶ候補に足す）', count: 2 },
      { from: '（空）', to: '（空）', count: 1 },
    ])
  })
})
