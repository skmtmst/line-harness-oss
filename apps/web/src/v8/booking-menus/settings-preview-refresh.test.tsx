// @vitest-environment happy-dom
/*
 * 監査 WEB057：受付枠・休業日・予約のルールを保存したら、右のお客さま画面の写しの
 * 空き枠も取り直す（保存前の決まりで取った空き枠を出し続けない）。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=hours'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./lib/edit-permission', () => ({ useBookingEdit: () => true }))
vi.mock('./tabs/hours-tab', () => ({
  HoursTabV8: ({ settings, onSaved }: { settings: unknown; onSaved: (s: unknown) => void }) => (
    <button type="button" onClick={() => onSaved({ ...(settings as object) })}>受付枠を保存（試験）</button>
  ),
  SlotCheckV8: () => null,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, staff: { ...actual.api.staff, list: async () => ({ success: true, data: [] }) } },
    bookingApi: {
      ...actual.bookingApi,
      listMenus: async () => ({ menus: [{ id: 'm1', name: 'カット', is_active: 1, sort_order: 1, version: 1 }] }),
      getSettings: async () => ({ success: true, data: { exceptions: [], businessHours: [] } }),
      listStaff: async () => ({ staff: [] }),
      listResources: async () => ({ resources: [] }),
      getAvailability: (...args: unknown[]) => net.availability(...args),
    },
  }
})

import Settings from './settings'
afterEach(cleanup)

it('受付枠を保存したら、写しの空き枠を取り直す', async () => {
  net.availability.mockResolvedValue({ by_staff: [], closed_dates: [] })
  render(<Settings accountId="a" />)
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve() })
  const before = net.availability.mock.calls.length
  expect(before).toBeGreaterThan(0)
  await act(async () => { screen.getByRole('button', { name: '受付枠を保存（試験）' }).click() })
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve() })
  expect(net.availability.mock.calls.length).toBeGreaterThan(before)
})
