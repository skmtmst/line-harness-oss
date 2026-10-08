// @vitest-environment happy-dom
/*
 * 監査 WEB074（画面側）：「使った・取り消し」は1ページずつ手元で絞っているので、
 * このページに無くても「ありません」と言い切らず、ページ送りを残す。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {} }),
  useSearchParams: () => new URLSearchParams('tab=history'),
  usePathname: () => '/mileage',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

const grant = (id: string) => ({
  id, friendId: 'f', displayName: '田中', entryType: 'grant', mode: 'automatic', amount: 10, reason: '来店',
  balanceAfter: 10, occurredAt: '2026-10-01T00:00:00.000Z', status: 'available', executedByStaffName: null,
})
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      mileage: {
        ...actual.api.mileage,
        history: async () => ({
          success: true,
          data: { items: Array.from({ length: 20 }, (_, i) => grant(`g${i}`)), summary: { byType: [] }, pagination: { total: 60, limit: 20, offset: 0 } },
        }),
      },
    },
  }
})

import HistoryTab from './history'
afterEach(cleanup)

test('使った・取り消しで、このページに無くても「まだありません」と言わず、ページ送りを残す', async () => {
  render(<HistoryTab />)
  await screen.findAllByText('田中')
  await act(async () => { screen.getByRole('button', { name: /使った・取り消し/ }).click() })
  await waitFor(() => expect(screen.getByText('このページには、使った・取り消しの履歴がありません')).toBeTruthy())
  expect(screen.queryByText('条件に合う履歴はありません')).toBeNull()
  expect(screen.getByText(/使った・取り消し 0件/)).toBeTruthy()
})
