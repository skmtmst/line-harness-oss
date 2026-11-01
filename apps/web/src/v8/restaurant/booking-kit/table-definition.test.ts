import { expect, it } from 'vitest'
import type { RestaurantSnapshot, RestaurantTable } from '@/lib/restaurant-test-api'
import { snapshotOf, tables } from './test-data'
import { tableCapacityReason } from './table-definition'
const own = tables.filter(t => t.is_active).map(t => ({ ...t, max_capacity: Math.min(t.max_capacity, 6) }))
function reason(rows: RestaurantTable[], guests = 7) {
  const snapshot = snapshotOf({ tables: rows }) as RestaurantSnapshot
  return tableCapacityReason({ accountId: 'account-1', snapshot }, 'account-1', 'store-1', rows, guests)
}
it('単独・有効結合の最大を含めて説明する', () => {
  expect(reason(own)).toBe('結合を含め最大6名のため、7名は入れません。')
  expect(reason(own.map(t => t.id === 't3' ? { ...t, max_capacity: 5 } : t))).toBeUndefined()
  expect(reason(own.map(t => t.id === 'pa' ? { ...t, max_capacity: 7 } : t))).toBeUndefined()
})
it('結合は全部の構成員を使い、min制約を最大超過と言わない', () => {
  const rows = own.slice(1, 3).map(t => ({ ...t, min_capacity: 4, max_capacity: 4 }))
  expect(reason(rows, 7)).toBe('7名に対応する卓・結合がありません。')
  expect(reason(rows, 8)).toBeUndefined()
  expect(reason(rows, 9)).toBe('結合を含め最大8名のため、9名は入れません。')
})
it('停止卓混在・構成不足・無効な定義・卓0で上限を推測しない', () => {
  expect(reason(tables)).toBeUndefined()
  expect(reason([...own, tables.find(table => !table.is_active)!])).toBeUndefined()
  expect(reason(own.filter(t => t.id !== 't2'))).toBeUndefined()
  expect(reason(own.map(t => ({ ...t, is_active: 0 })))).toBeUndefined()
  expect(reason([])).toBeUndefined()
  expect(reason(own.map(t => ({ ...t, min_capacity: 0 })))).toBeUndefined()
  expect(reason([...own, own[0]])).toBeUndefined()
})
it('取得元・店・参照・完全な一覧が一致する時だけ説明する', () => {
  const snapshot = snapshotOf({ tables: own }) as RestaurantSnapshot
  const definition = { accountId: 'account-1', snapshot }
  expect(tableCapacityReason(undefined, 'account-1', 'store-1', own, 7)).toBeUndefined()
  expect(tableCapacityReason(definition, null, 'store-1', own, 7)).toBeUndefined()
  expect(tableCapacityReason(definition, 'other', 'store-1', own, 7)).toBeUndefined()
  expect(tableCapacityReason(definition, 'account-1', 'other', own, 7)).toBeUndefined()
  expect(tableCapacityReason(definition, 'account-1', 'store-1', own.slice(1), 7)).toBeUndefined()
  expect(tableCapacityReason(definition, 'account-1', 'store-1', own.map(t => ({ ...t })), 7)).toBeUndefined()
  expect(tableCapacityReason({ ...definition, snapshot: { ...snapshot, organization: null } }, 'account-1', 'store-1', own, 7)).toBeUndefined()
  expect(reason(own, 1.5)).toBeUndefined()
})

it('要求元が店舗accountで組織の元accountが違っても、正当な取得情報なら説明する', () => {
  const snapshot = snapshotOf({ tables: own }) as RestaurantSnapshot
  snapshot.organization = { ...snapshot.organization!, account_id: 'organization-primary' }
  const definition = { accountId: 'account-1', snapshot }
  expect(tableCapacityReason(definition, 'account-1', 'store-1', own, 7)).toBe('結合を含め最大6名のため、7名は入れません。')
  expect(tableCapacityReason({ ...definition, accountId: 'old-request-source' }, 'account-1', 'store-1', own, 7)).toBeUndefined()
  expect(tableCapacityReason({ ...definition, snapshot: { ...snapshot, organization: null } }, 'account-1', 'store-1', own, 7)).toBeUndefined()
})
