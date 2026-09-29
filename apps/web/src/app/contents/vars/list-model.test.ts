import type { CommonVar } from '@line-crm/shared'
import { describe, expect, it } from 'vitest'
import { filterAndSortCommonVars } from './list-model'

function item(over: Partial<CommonVar> = {}): CommonVar {
  return {
    id: 'v1', lineAccountId: 'a1', folderId: null, name: '会社名', varKey: 'company',
    type: 'text', value: '株式会社NEN', createdAt: '2026-08-01', updatedAt: '2026-08-02',
    usageCount: 3, nextSchedule: null, validFrom: null, validUntil: null,
    fallbackValue: null, expiryBehavior: 'stop', ...over,
  }
}

describe('共通情報一覧の絞り込みと並び順', () => {
  const input = { query: '', folderId: '', ungroupedValue: '__ungrouped__', filter: 'all' as const, order: 'usage_desc' as const }

  it('空・期限つき・未使用を実値で絞り込む', () => {
    const values = [
      item({ id: 'empty', value: '' }),
      item({ id: 'scheduled', nextSchedule: { effectiveFrom: '2026-09-30', value: '' } }),
      // VAR-04: 有効期間（開始だけ・終了だけ・両方）を設定したものも「期限つき」で拾う
      item({ id: 'period-both', validFrom: '2026-09-01T00:00:00.000Z', validUntil: '2026-09-30T15:00:00.000Z' }),
      item({ id: 'period-until', validUntil: '2026-09-30T15:00:00.000Z' }),
      item({ id: 'unused', usageCount: 0 }),
    ]
    expect(filterAndSortCommonVars(values, { ...input, filter: 'empty' }).map((value) => value.id)).toEqual(['empty'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'scheduled' }).map((value) => value.id))
      .toEqual(['scheduled', 'period-both', 'period-until'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'unused' }).map((value) => value.id)).toEqual(['unused'])
  })

  it('状態（下書き・止めた・期限切れ）で絞り込む（Q）', () => {
    const values = [
      item({ id: 'draft', status: 'draft', state: 'draft' }),
      item({ id: 'active', status: 'active', state: 'active' }),
      item({ id: 'stopped', status: 'stopped', state: 'stopped' }),
      item({ id: 'expired', status: 'active', state: 'expired' }),
      // state が来ない旧データは使用中扱い（サーバの既定と同じ）。
      item({ id: 'legacy', state: undefined }),
    ]
    expect(filterAndSortCommonVars(values, { ...input, filter: 'draft' }).map((value) => value.id)).toEqual(['draft'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'stopped' }).map((value) => value.id)).toEqual(['stopped'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'expired' }).map((value) => value.id)).toEqual(['expired'])
    expect(filterAndSortCommonVars(values, { ...input, filter: 'all' }).map((value) => value.id))
      .toEqual(['draft', 'active', 'stopped', 'expired', 'legacy'])
  })

  it('使用数が未取得の行を未使用へ混ぜない', () => {
    expect(filterAndSortCommonVars([item({ usageCount: undefined })], { ...input, filter: 'unused' })).toEqual([])
  })

  it('使用数順では未取得を末尾へ置く', () => {
    const values = [item({ id: 'unknown', usageCount: undefined }), item({ id: 'used', usageCount: 8 })]
    expect(filterAndSortCommonVars(values, input).map((value) => value.id)).toEqual(['used', 'unknown'])
  })
})
