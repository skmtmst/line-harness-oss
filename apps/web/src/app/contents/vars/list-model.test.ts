import type { CommonVar } from '@line-crm/shared'
import { describe, expect, it } from 'vitest'
import { commonVarsCsv, filterAndSortCommonVars } from './list-model'

function item(over: Partial<CommonVar> = {}): CommonVar {
  return {
    id: 'v1', lineAccountId: 'a1', folderId: null, name: '会社名', varKey: 'company',
    type: 'text', value: '株式会社NEN', createdAt: '2026-08-01', updatedAt: '2026-08-02',
    usageCount: 3, nextSchedule: null, ...over,
  }
}

describe('共通情報一覧の絞り込みと並び順', () => {
  const input = { query: '', folderId: '', ungroupedValue: '__ungrouped__', filter: 'all' as const, order: 'usage_desc' as const }

  it('空・期限つき・未使用を実値で絞り込む', () => {
    const values = [
      item({ id: 'empty', value: '' }),
      item({ id: 'scheduled', nextSchedule: { effectiveFrom: '2026-09-30', value: '' } }),
      item({ id: 'unused', usageCount: 0 }),
    ]
    expect(filterAndSortCommonVars(values, { ...input, filter: 'empty' }).map((value) => value.id)).toEqual(['empty'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'scheduled' }).map((value) => value.id)).toEqual(['scheduled'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'unused' }).map((value) => value.id)).toEqual(['unused'])
  })

  it('使用数が未取得の行を未使用へ混ぜない', () => {
    expect(filterAndSortCommonVars([item({ usageCount: undefined })], { ...input, filter: 'unused' })).toEqual([])
  })

  it('使用数順では未取得を末尾へ置く', () => {
    const values = [item({ id: 'unknown', usageCount: undefined }), item({ id: 'used', usageCount: 8 })]
    expect(filterAndSortCommonVars(values, input).map((value) => value.id)).toEqual(['used', 'unknown'])
  })
})

describe('共通情報一覧のCSV', () => {
  it('運用者に見せる差し込みキーと未取得をそのまま書く', () => {
    const csv = commonVarsCsv([item({ usageCount: undefined, name: '会社"名' })])
    expect(csv).toContain('"{会社""名}"')
    expect(csv).toContain('"未取得"')
    expect(csv).not.toContain('{{var.')
  })
})
