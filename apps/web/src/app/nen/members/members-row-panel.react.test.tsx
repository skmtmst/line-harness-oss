// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * V8「サクサク感」C①②・D・E：NEN会員一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「会員の詳細」は友だち詳細へ進む。
 * 名前のその場の書き換えは無し（名前はLINE・EC側の持ち物で、変える口が無いため）。
 */

const pushes: string[] = []
const m = vi.hoisted(() => ({
  members: vi.fn(),
}))

vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: m }))
vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => 'owner',
  canManageRole: () => true,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {}, usePageTitle: () => {} }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))

import MembersPageV8 from './members-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const member = (friendId: string, name: string, customerId: string | null) => ({
  friendId,
  name,
  pictureUrl: null,
  customerId,
  rankKey: 'gold',
  rankName: 'ゴールド',
  mileRatePercent: 3,
  annualMilesYen: 12000,
  lifetimeMilesYen: 45000,
  mileBalance: 800,
  rankValidUntil: null,
  lastPurchasedAt: '2026-09-20',
  purchaseCount: 5,
  petCount: 1,
  petNames: 'ポチ',
  syncedAt: '2026-10-01',
})

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  pushes.length = 0
  vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
  m.members.mockResolvedValue({
    success: true,
    data: {
      items: [member('f1', '田中花子', 'c-101'), member('f2', '佐藤次郎', null)],
      total: 2,
      page: 1,
      pageSize: 10,
      kpis: { members: 2, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
      ranks: [],
    },
  })
})
afterEach(() => {
  cleanup()
})

async function eventually(check: () => void, timeout = 3000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

async function openFirstRow() {
  render(<MembersPageV8 accountId="acc-1" tab="members" status="ready" settings={null} onRetry={() => {}} onSaved={() => {}} onChangeTab={() => {}} />)
  await eventually(() => {
    if (!document.body.textContent?.includes('田中花子')) throw new Error('row not loaded')
  })
  const firstRow = document.body.querySelector('tbody tr')
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

describe('NEN会員V8の行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openFirstRow()
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('田中花子')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('佐藤次郎')) throw new Error('did not move')
    })
  })

  it('パネルの「会員の詳細」は友だち詳細へ進む', async () => {
    await openFirstRow()
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const open = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '会員の詳細')
    if (!open) throw new Error('no open button')
    await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/friends/detail?id=f1'])
  })
})
