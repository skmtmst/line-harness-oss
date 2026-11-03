import { MILEAGE_FRIENDS } from './fixtures.mjs'

// EC の実 API と同じく、表示するランクは設定名、残高の合計と取得人数は EC の取得済みデータから作る。
const ecRankNames = { gold: 'ゴールド', silver: 'シルバー', bronze: 'ブロンズ' }
const ecMileageItems = MILEAGE_FRIENDS.items.map((item) => ({
  ...item, rank: ecRankNames[item.rank] ?? '未設定', rankReason: 'ECと同期',
  ecBalance: item.available, pending: 0, monthChange: 0, rankThreshold: null,
  nextRank: null, nextRankThreshold: null, milesToNextRank: null,
  expiringMiles30d: null, nextExpiringAt: null, lifetimeEarned: 0, spent: 0, lastAction: null,
}))
export const MILEAGE_FRIENDS_EC = {
  ...MILEAGE_FRIENDS, balanceSource: 'ec', ecKnownCount: ecMileageItems.length,
  items: ecMileageItems,
  summary: { ...MILEAGE_FRIENDS.summary, totalMembers: ecMileageItems.length, withBalanceCount: ecMileageItems.filter((item) => item.available > 0).length, available: ecMileageItems.reduce((sum, item) => sum + item.available, 0), pending: 0, monthChange: 0, rankCounts: [], expiringMiles30d: null, nextExpiringAt: null },
  pagination: { total: ecMileageItems.length, limit: 20, offset: 0 },
}
