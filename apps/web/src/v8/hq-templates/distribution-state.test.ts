import { expect, it } from 'vitest'
import { stateOf } from './store-list-stats'
import type { HqTemplate } from '@/lib/hq-templates-api'

it('配布履歴から公開中と推測せず、配布と更新待ちを区別する', () => {
  const row = { distributed_account_count: 3, outdated_account_count: 0 } as HqTemplate
  expect(stateOf(row).label).toBe('配布済み')
  expect(stateOf({ ...row, outdated_account_count: 1 }).label).toBe('更新の配布待ち')
  expect(stateOf({ ...row, distributed_account_count: 0 }).label).toBe('未配布')
})

it.each([
  {},
  { distributed_account_count: 3 },
  { outdated_account_count: 0 },
])('取得していない配布状態を未配布や配布済みにしない: %j', fields => {
  expect(stateOf(fields as HqTemplate)).toEqual({ label: '—', tone: 'draft' })
})

it('確認済みの配布0件と、保存された配布履歴を区別する', () => {
  expect(stateOf({ distributed_account_count: 0 } as HqTemplate).label).toBe('未配布')
  expect(stateOf({ distributed_account_count: 3, outdated_account_count: 0, archived_at: '2026-10-28T00:00:00Z' } as HqTemplate).label).toBe('配布済み')
})
