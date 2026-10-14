// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const setCount = vi.hoisted(() => vi.fn())
vi.mock('./frame', async original => ({
  ...await original<typeof import('./frame')>(),
  useAffiliateShell: () => ({ readonly: true, narrow: false, accountId: 'a', setCount }),
  AffiliateFrame: ({ children, pagination }: { children: ReactNode; pagination: ReactNode }) => <>{children}{pagination}</>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(), usePathname: () => '/affiliates',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./display', async original => ({
  ...await original<typeof import('./display')>(),
  listAllConversionApprovals: async (status: string) => ({ truncated: false, items: status === 'pending'
    ? [{ eventId: 'c', lineAccountId: 'a', friendName: '成果の友だち', approvalStatus: 'pending', createdAt: '2026-10-01T00:00:00Z' }] : [] }),
}))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  const empty = async () => ({ success: true, data: [] })
  return { ...actual, api: { ...actual.api,
    affiliates: { ...actual.api.affiliates, list: empty, allReport: empty, paymentSummaries: empty,
      settlementCurrent: async () => ({ success: true, data: null }),
      settlementPreview: async () => ({ success: true, data: { totalAmount: 100, conversionCount: 1,
        affiliates: [{ affiliateId: 'a1', affiliateName: '支払い相手', rewardAmount: 100, conversionCount: 1, bankProfileRegistered: true }] } }),
    },
    affiliateOffers: { ...actual.api.affiliateOffers, list: async () => ({ success: true, data: [{ id: 'o', name: '案件', isActive: true, rewardAmount: 100, rewardMiles: 0, createdAt: '2026-10-01T00:00:00Z' }] }) },
    conversionApprovals: { ...actual.api.conversionApprovals, holdDays: async () => ({ success: true, data: {} }) },
    lineAccounts: { ...actual.api.lineAccounts, list: empty }, tags: { ...actual.api.tags, list: empty }, scenarios: { ...actual.api.scenarios, list: empty },
  } }
})

import OffersTab from './offers'
import ApprovalsTab from './approvals'
import PaymentTab from './payment'
import { flushListUrlState } from '@/components/shared/list-url-state'

beforeEach(() => { flushListUrlState(); window.history.replaceState(null, '', '/affiliates') })
afterEach(cleanup)

it.each([
  ['案件', OffersTab, '件'], ['成果承認', ApprovalsTab, '件'], ['支払い', PaymentTab, '人'],
] as const)('%sは1ページでも共通の件数と送り先を出す', async (_name, Tab, unit) => {
  render(<Tab />)
  expect(await screen.findByText(`1${unit}中 1〜1${unit}`)).toBeTruthy()
  expect((screen.getByRole('button', { name: '前のページ' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '次のページ' }) as HTMLButtonElement).disabled).toBe(true)
})
