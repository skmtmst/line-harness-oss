// @vitest-environment happy-dom
/*
 * ★V8-B 会員一覧 AOWoJ の数の帯：F-19 の数（ペット登録あり・今月の購入）を
 * API の実データで出す。絵の例示の数は書かない。単位「人」は数と分ける。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MembersKpiBand } from './members-v8'

afterEach(cleanup)

const ranks = [
  { id: 'r1', key: 'platinum', name: 'プラチナ', annualThresholdYen: 100000, mileRatePercent: 5, tagId: null, tagName: null, memberCount: 1 },
  { id: 'r2', key: 'gold', name: 'ゴールド', annualThresholdYen: 50000, mileRatePercent: 3, tagId: null, tagName: null, memberCount: 3 },
]

const kpis = {
  members: 12,
  annualTotalYen: 211000,
  lifetimeTotalYen: 509100,
  balanceTotal: 3960,
  usedThisMonth: 500,
  byRank: { platinum: 1, gold: 3 },
  linkedMembers: 9,
  petMembers: 5,
  monthPurchaseYen: 10000,
  monthBuyers: 2,
}

describe('会員の数の帯（F-19）', () => {
  it('ペット登録ありと今月の購入を実データで出す', () => {
    render(<MembersKpiBand kpis={kpis} ranks={ranks} loading={false} />)
    expect(screen.getByText('ペット登録あり')).toBeTruthy()
    expect(screen.getByText('今月の購入')).toBeTruthy()
    // 数と単位は分かれている（12 ＋ 人）。
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('¥10,000')).toBeTruthy()
    expect(screen.getByText('会員 2 人')).toBeTruthy()
  })

  it('読み込み中は数を伏せる', () => {
    render(<MembersKpiBand kpis={null} ranks={ranks} loading />)
    expect(screen.queryByText('ペット登録あり')).toBeTruthy()
    expect(screen.queryByText('¥10,000')).toBeNull()
  })
})
