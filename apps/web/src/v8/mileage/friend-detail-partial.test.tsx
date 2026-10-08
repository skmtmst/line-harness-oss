// @vitest-environment happy-dom
/*
 * 監査 WEB075（画面側）：友だちのマイル明細は最新100件だけ読んでいる。全件より少ないとき、
 * 「今月たまった」を一部から数えて出さず、ページ送りの件数にも一部だと書く。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {} }),
  useSearchParams: () => new URLSearchParams('id=f1'),
  usePathname: () => '/mileage/friend',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

const today = new Date().toISOString()
const entry = (id: string) => ({
  id, entryType: 'grant', status: 'available', amount: 10, reason: '来店', source: 'rule', hasSourceEvent: false,
  sourceReferenceId: null, ruleName: null, mode: 'automatic', executedByStaffName: null, lineAccountId: 'acc',
  notificationStatus: null, notificationErrorCode: null, balanceAfter: 10, occurredAt: today, displayName: '田中',
})
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: async () => ({ success: true, data: { id: 'f1', displayName: '田中', createdAt: '2026-01-01T00:00:00Z' } }),
        mileage: async () => ({ success: true, data: { summary: { available: 0, pending: 0, lifetimeEarned: 0, spent: 0 }, history: [], insights: null } }),
      },
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: 'staff' } }) },
      mileage: {
        ...actual.api.mileage,
        friendsV6: async () => ({ success: false, error: 'x' }),
        history: async () => ({ success: true, data: { items: Array.from({ length: 100 }, (_, i) => entry(`e${i}`)), summary: { byType: [] }, pagination: { total: 340, limit: 100, offset: 0 } } }),
      },
    },
  }
})

import FriendDetailV8 from './friend-detail'
afterEach(cleanup)

test('最新100件より多いとき、今月の数は「数えられません」、件数は一部と書く', async () => {
  render(<FriendDetailV8 />)
  await screen.findByText('最新100件だけでは数えられません')
  expect(screen.getByText(/最新100件（全340件）のうち/)).toBeTruthy()
})
