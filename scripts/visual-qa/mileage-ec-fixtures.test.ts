import { expect, it } from 'vitest'
import { MILEAGE_FRIENDS_EC } from './mileage-ec-fixtures.mjs'

it('EC残高の撮影データは設定名と取得件数・合計が一致する', () => {
  expect(MILEAGE_FRIENDS_EC.balanceSource).toBe('ec')
  expect(MILEAGE_FRIENDS_EC.items.map((item: { rank: string }) => item.rank)).toEqual(['ゴールド', 'ゴールド', 'シルバー', 'シルバー', 'ブロンズ', 'ブロンズ'])
  const known = MILEAGE_FRIENDS_EC.items.filter((item): item is typeof item & { available: number } => item.available !== null)
  expect(MILEAGE_FRIENDS_EC.ecKnownCount).toBe(known.length)
  expect(MILEAGE_FRIENDS_EC.ecKnownCount).toBe(6)
  expect(MILEAGE_FRIENDS_EC.summary.available).toBe(21670)
  expect(MILEAGE_FRIENDS_EC.summary.available).toBe(known.reduce((sum: number, item: { available: number }) => sum + item.available, 0))
  expect(MILEAGE_FRIENDS_EC.items[0]).toMatchObject({ rankThreshold: null, nextRank: null, nextRankThreshold: null, milesToNextRank: null, expiringMiles30d: null, nextExpiringAt: null, lifetimeEarned: 0, spent: 0, lastAction: null })
})
