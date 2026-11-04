/*
 * 監査 WEB033：すぐ送るテンプレートだけを設定した経路を「動きが未設定」と数えない。
 */
import { describe, expect, it } from 'vitest'
import type { EntryRoute } from '@line-crm/shared'
import { becameLines, buildRows, isUnconfigured, matchesFilter } from './rows'

const route = (overrides: Partial<EntryRoute>): EntryRoute => ({
  id: 'er-1', refCode: 'r1', genre: null, name: '経路', tagId: null, scenarioId: null,
  redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true,
  stoppedAt: null, stoppedReason: null, createdAt: '', updatedAt: '',
  ...overrides,
} as EntryRoute)

describe('流入経路の「動き」（WEB033）', () => {
  it('テンプレートだけの経路は未設定ではなく、「テンプレートを送る」と出す', () => {
    const [row] = buildRows([route({ introTemplateId: 'tpl-1' })], [], null)
    expect(isUnconfigured(row)).toBe(false)
    expect(becameLines(row, undefined, undefined, 'ようこそ')).toEqual(['—', 'テンプレート「ようこそ」を送る'])
  })

  it('何も無い経路は今までどおり未設定（対照）', () => {
    const [row] = buildRows([route({})], [], null)
    expect(isUnconfigured(row)).toBe(true)
    expect(becameLines(row, undefined, undefined)).toEqual(['—', '何も付けない'])
  })
})

it('友だち数が不明の経路は0人の絞り込みに含めず、実際の0人は含める', () => {
  const [unknown] = buildRows([route({})], [], null)
  const zero = { ...unknown, stats: { refCode: 'r1', name: null, friendCount: 0, clickCount: 0, latestAt: null } }
  expect(matchesFilter(unknown, 'no-friends')).toBe(false)
  expect(matchesFilter(unknown, 'has-friends')).toBe(false)
  expect(matchesFilter(zero, 'no-friends')).toBe(true)
  expect(matchesFilter(zero, 'has-friends')).toBe(false)
})
