// @vitest-environment happy-dom
/*
 * V8 会員一覧：並び順を選べる（v7 parity-D）。
 * 変えると口へ新しい並びを渡して読み直す。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { NenMemberListData, NenRankSettingsData } from '@/lib/nen-ranks-api'
import MembersPageV8 from './members-v8'

const calls = vi.hoisted(() => ({ members: vi.fn() }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { members: calls.members } }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => null, canManageRole: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/nen/members',
}))

const settings: NenRankSettingsData = {
  ranks: [],
  milestones: [],
  rules: null,
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

const list: NenMemberListData = {
  items: [
    {
      friendId: 'f1', name: '山田', pictureUrl: null, customerId: null,
      rankKey: null, rankName: 'レギュラー', mileRatePercent: 1,
      annualMilesYen: 1000, lifetimeMilesYen: 2000, mileBalance: 300,
      rankValidUntil: null, lastPurchasedAt: '2026-09-01', purchaseCount: 2,
      petCount: 0, petNames: null, syncedAt: '2026-09-27T00:00:00+09:00',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
  kpis: settings.kpis,
  ranks: [],
}

afterEach(cleanup)

describe('V8 会員一覧の並び順', () => {
  it('変えると新しい並びで読み直す', async () => {
    calls.members.mockResolvedValue({ success: true, data: list })
    render(
      <MembersPageV8
        accountId="acc-1"
        tab="members"
        status="ready"
        settings={settings}
        onRetry={() => {}}
        onSaved={() => {}}
        onChangeTab={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('山田')).toBeTruthy())
    expect(calls.members).toHaveBeenCalledWith('acc-1', expect.objectContaining({ sort: 'annual_desc' }))
    fireEvent.click(screen.getByLabelText('並び順'))
    fireEvent.click(await screen.findByRole('button', { name: '最終購入が新しい順' }))
    await waitFor(() => expect(calls.members).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ sort: 'recent' }),
    ))
  })
})
