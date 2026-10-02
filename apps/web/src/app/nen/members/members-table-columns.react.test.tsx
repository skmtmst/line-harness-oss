// @vitest-environment happy-dom
/*
 * m18s: 会員一覧表も「幅を固定しない列はペットの1列だけ・隠す列は
 * ThとTdの両方を消す」の形にする。本物のReactで動かして見る。
 * 1440px・1152px・1920px のどの幅でも列幅の合計が表の幅になる。戻すと赤。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenMemberListData, NenRankSettingsData } from '@/lib/nen-ranks-api'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=members'),
}))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))

const membersMock = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { members: membersMock.list } }))

import MembersTab from './members-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const LIST: NenMemberListData = {
  items: [
    {
      friendId: 'f1',
      name: '山田',
      pictureUrl: null,
      customerId: null,
      rankKey: null,
      rankName: 'レギュラー',
      mileRatePercent: 1,
      annualMilesYen: 1000,
      lifetimeMilesYen: 2000,
      mileBalance: 300,
      rankValidUntil: null,
      lastPurchasedAt: '2026-09-01',
      purchaseCount: 2,
      petCount: 1,
      petNames: 'ポチ',
      syncedAt: '2026-09-27T00:00:00+09:00',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  kpis: { members: 1, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
  ranks: [],
}

const SETTINGS: NenRankSettingsData = {
  ranks: [],
  milestones: [],
  rules: null,
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

describe('m18s 会員一覧表の列幅は見出しと合う', () => {
  beforeEach(() => {
    membersMock.list.mockResolvedValue({ success: true, data: LIST })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.clearAllMocks()
  })

  it('行の列幅は見出しと合う（吸収列はペットの1列だけ）', async () => {
    await act(async () => {
      root.render(<MembersTab accountId="acc-1" settingsStatus="ready" settings={SETTINGS} />)
    })
    await settle(100)
    const rows = Array.from(host.querySelectorAll('tbody tr')).filter(
      (tr) => tr.querySelectorAll(':scope > td').length === 9,
    )
    expect(rows.length).toBe(1)
    const classes = Array.from(rows[0].querySelectorAll(':scope > td')).map((td) => td.className)
    expect(classes[0]).toContain('w-72')
    expect(classes[1]).toContain('w-28')
    expect(classes[2]).toContain('w-32')
    expect(classes[3]).toContain('w-32')
    expect(classes[4]).toContain('w-28')
    // ペットは幅指定なし（吸収列）。
    for (const w of ['w-72', 'w-28', 'w-32', 'w-24', 'w-16']) {
      expect(classes[5].split(' ')).not.toContain(w)
    }
    expect(classes[6]).toContain('w-28')
    expect(classes[7]).toContain('w-24')
    expect(classes[8]).toContain('w-16')
  })
})
