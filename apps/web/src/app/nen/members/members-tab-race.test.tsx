// @vitest-environment happy-dom
/*
 * R56: 会員一覧で古い通信結果が選択中アカウントの一覧を上書きする。
 * A→Bの順に要求し、B→Aの順に応答すると最終表示はA（選択はBのまま）。
 * 監査の再現（隔離・遅延Promiseの制御）を描画試験で固定する。
 * 修正後の期待：現在のアカウントに対応する最新の応答だけ採用する。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NenMemberListData, NenMemberRow, NenRankSettingsData } from '@/lib/nen-ranks-api'

const m = vi.hoisted(() => ({ members: vi.fn() }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { members: m.members } }))

import MembersTab from './members-tab'

const flush = () => act(async () => { await Promise.resolve() })

function row(name: string): NenMemberRow {
  return {
    friendId: `friend-${name}`,
    name,
    pictureUrl: null,
    customerId: null,
    rankKey: null,
    rankName: 'レギュラー',
    mileRatePercent: null,
    annualMilesYen: 0,
    lifetimeMilesYen: 0,
    mileBalance: 0,
    rankValidUntil: null,
    lastPurchasedAt: null,
    purchaseCount: 0,
    petCount: 0,
    petNames: null,
    syncedAt: '2026-09-27T10:00:00+09:00',
  }
}

function listData(name: string): NenMemberListData {
  return {
    items: [row(name)],
    total: 1,
    page: 1,
    pageSize: 20,
    kpis: { members: 1, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
    ranks: [],
  }
}

const settings: NenRankSettingsData = {
  ranks: [],
  milestones: [],
  rules: null,
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

afterEach(cleanup)

describe('R56 会員一覧の応答の取り違え', () => {
  it('Bへ切り替えた後にAの応答が遅れて届いても、Bの一覧を残す', async () => {
    const resolvers = new Map<string, (value: { success: true; data: NenMemberListData }) => void>()
    m.members.mockImplementation((accountId: string) => new Promise((resolve) => {
      resolvers.set(accountId, resolve as never)
    }))
    const v = render(<MembersTab accountId="A" settingsStatus="ready" settings={settings} />)
    await flush()
    expect(m.members).toHaveBeenCalledWith('A', expect.anything())

    v.rerender(<MembersTab accountId="B" settingsStatus="ready" settings={settings} />)
    await flush()
    expect(m.members).toHaveBeenCalledWith('B', expect.anything())

    // Bが先に応答し、Aが遅れて応答する。
    await act(async () => { resolvers.get('B')!({ success: true, data: listData('Bの会員') }) })
    await act(async () => { resolvers.get('A')!({ success: true, data: listData('Aの会員') }) })

    expect(screen.queryByText('Bの会員')).toBeTruthy()
    expect(screen.queryByText('Aの会員')).toBeNull()
  })
})
