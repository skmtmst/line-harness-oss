// @vitest-environment happy-dom
/*
 * V8 たまる決めごと：「止めているのみ」の見方を選ぶと止めている決めごとだけ出る。
 * 以前は既定と同じ条件で、動いているものも混ざっていた（v7 parity-D）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import V8EarningRulesTab from './v8-earning-rules-tab'
import type { MileageEarningRuleV6 } from '@/lib/api'

const calls = vi.hoisted(() => ({ earningRulesV6: vi.fn(), history: vi.fn(), friendsV6: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: {
    mileage: {
      earningRulesV6: calls.earningRulesV6,
      history: calls.history,
      friendsV6: calls.friendsV6,
    },
  },
  ApiError: class extends Error { status?: number },
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mileage',
}))
vi.mock('@/lib/admin-session', () => ({ adminSessionHeaders: () => ({}) }))

function rule(id: string, name: string, status: 'published' | 'stopped'): MileageEarningRuleV6 {
  return {
    id,
    published: {
      name, eventType: 'purchase', source: null, amount: 10,
      initialStatus: 'available', validFrom: null, validUntil: null,
      status, updatedAt: '2026-09-01T00:00:00+09:00',
    },
    draft: {
      name, eventType: 'purchase', source: null, amount: 10,
      initialStatus: 'available', validFrom: null, validUntil: null,
      expiresAfterDays: null, cancellationEventTypes: [],
      targetConditions: null, sortOrder: 0,
    },
    draftVersion: 1,
    draftUpdatedAt: '2026-09-01T00:00:00+09:00',
    publishedVersion: status === 'published' ? 1 : null,
    metrics30d: { eligible: 0, granted: 0, grantedMiles: 0, excluded: 0 },
  }
}

const overview = (items: MileageEarningRuleV6[]) => ({
  items,
  pagination: { total: items.length, limit: 100, offset: 0 },
  unassignedLegacyCount: 0,
  measuredAt: '2026-09-01T00:00:00+09:00',
})

afterEach(cleanup)

describe('V8 たまる決めごとの「止めているのみ」', () => {
  it('止めている決めごとだけ出す', async () => {
    const items = [rule('r1', '動いている決めごと', 'published'), rule('r2', '止めている決めごと', 'stopped')]
    calls.earningRulesV6.mockResolvedValue({ success: true, data: overview(items) })
    calls.history.mockResolvedValue({ success: true, data: { summary: { byType: [] } } })
    calls.friendsV6.mockResolvedValue({
      success: true,
      data: {
        items: [],
        summary: {
          available: 0, totalMembers: 0, withBalanceCount: 0, pending: 0,
          monthChange: 0, rankCounts: [], expiringMiles30d: null, nextExpiringAt: null,
        },
        pagination: { total: 0, limit: 1, offset: 0 },
        measuredAt: '2026-09-01T00:00:00+09:00',
      },
    })
    render(<V8EarningRulesTab readonly={false} registerHeaderActions={() => {}} />)
    await waitFor(() => expect(screen.getByText('動いている決めごと')).toBeTruthy())
    expect(screen.getByText('止めている決めごと')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('よく使う絞り込み'))
    fireEvent.click(await screen.findByRole('button', { name: '止めているのみ' }))
    await waitFor(() => expect(screen.queryByText('動いている決めごと')).toBeNull())
    expect(screen.getByText('止めている決めごと')).toBeTruthy()
  })
})
