import { describe, expect, it } from 'vitest'
import { isMileageFriendsV6Overview } from './friends-overview-guard'

/*
 * D022: 友だち残高の応答検査は、描画が読む項目まで見る。
 * `rankCounts`（・`monthChange`・`expiringMiles30d`・`measuredAt`）を欠く
 * 応答は弾く（描画で落ちず「読み込めませんでした」＋再読み込みになる）。
 */

function fullResponse() {
  return {
    summary: {
      totalMembers: 10,
      withBalanceCount: 4,
      available: 1200,
      pending: 300,
      monthChange: 50,
      rankCounts: [{ rewardId: 'r1', rankName: 'ゴールド', requiredMiles: 1000, friendCount: 2 }],
      expiringMiles30d: 100,
      nextExpiringAt: null,
    },
    items: [],
    pagination: { total: 0, limit: 20, offset: 0 },
    measuredAt: '2026-09-29T00:00:00.000Z',
  }
}

describe('D022 友だち残高の応答検査', () => {
  it('完全な形は通る', () => {
    expect(isMileageFriendsV6Overview(fullResponse())).toBe(true)
  })

  it('正常な空応答（全項目あり・0件）は通る', () => {
    const empty = fullResponse()
    empty.summary.rankCounts = []
    empty.summary.expiringMiles30d = null
    expect(isMileageFriendsV6Overview(empty)).toBe(true)
  })

  it('rankCountsを欠く応答は弾く', () => {
    const broken = fullResponse() as Record<string, unknown>
    const summary = { ...(broken.summary as Record<string, unknown>) }
    delete summary.rankCounts
    broken.summary = summary
    expect(isMileageFriendsV6Overview(broken)).toBe(false)
  })

  it('monthChange・expiringMiles30d・measuredAtの欠損も弾く', () => {
    const noMonth = fullResponse() as unknown as Record<string, unknown>
    const summaryMonth = { ...(noMonth.summary as Record<string, unknown>) }
    delete summaryMonth.monthChange
    noMonth.summary = summaryMonth
    expect(isMileageFriendsV6Overview(noMonth)).toBe(false)

    const noExpiring = fullResponse() as unknown as Record<string, unknown>
    const summaryExpiring = { ...(noExpiring.summary as Record<string, unknown>) }
    delete summaryExpiring.expiringMiles30d
    noExpiring.summary = summaryExpiring
    expect(isMileageFriendsV6Overview(noExpiring)).toBe(false)

    const noMeasured = fullResponse() as unknown as Record<string, unknown>
    delete noMeasured.measuredAt
    expect(isMileageFriendsV6Overview(noMeasured)).toBe(false)
  })

  it('型違い（数値のはずが文字列など）も弾く', () => {
    const wrong = fullResponse() as unknown as Record<string, unknown>
    const summary = { ...(wrong.summary as Record<string, unknown>), available: '1200' }
    wrong.summary = summary
    expect(isMileageFriendsV6Overview(wrong)).toBe(false)
  })
})
