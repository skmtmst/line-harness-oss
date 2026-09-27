// @vitest-environment happy-dom
/*
 * T: 予約詳細の「予約した時の内容」。
 * 写しが無い・いまと同じなら出さない（同じ数字を二度出さない）。
 * メニューを変えた後にだけ、写しが出る。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ account: 'A', id: 'one', get: vi.fn() }))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: m.account }),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ id: m.id }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: { staff: { me: async () => ({ success: true, data: { role: 'owner' } }) } },
  bookingApi: {
    getBooking: m.get,
    decideRequest: vi.fn(async () => ({ status: 'confirmed' })),
    listMenus: vi.fn(async () => ({ menus: [] })),
    listMenuStaff: vi.fn(async () => ({ staff: [] })),
    getAvailability: vi.fn(async () => ({ by_staff: [] })),
    updateBooking: vi.fn(async () => ({})),
    retryCalendarSync: vi.fn(async () => ({ status: 'succeeded' })),
    retryNotification: vi.fn(async () => ({ status: 'succeeded' })),
    getAuditLogs: vi.fn(async () => ({ audit_logs: [] })),
  },
}))

import Page from './page'

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 'one',
  menuId: 'menu-a',
  menuName: 'カット',
  staffId: 'staff',
  staffName: '担当',
  status: 'confirmed',
  price: 8000,
  startsAt: '2026-09-20T01:00:00Z',
  endsAt: '2026-09-20T02:00:00Z',
  requestedAt: '2026-09-19T01:00:00Z',
  source: 'liff',
  customer: {
    displayName: '顧客',
    isLineLinked: true,
    friendId: null,
    phone: null,
    bookingCustomerId: null,
    petName: null,
    tags: [],
    mileageBalance: null,
  },
  previousHandover: null,
  notificationPolicy: { send_line_confirmation: false, day_before: false, hours_before: false },
  history: [],
  operations: [],
  reminders: [],
  auditLogs: [],
  auditLogTotal: 0,
  lockVersion: 1,
  calendarSync: 'not_configured',
  ...overrides,
})

const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)

describe('予約した時の内容', () => {
  it('写しが無ければ出ない', async () => {
    m.get.mockResolvedValue({ booking: booking() })
    render(<Page />)
    await flush()
    expect(screen.queryByText('予約した時の内容')).toBeNull()
  })

  it('写しがいまと同じなら出ない', async () => {
    m.get.mockResolvedValue({
      booking: booking({
        menuSnapshot: {
          version: 2, name: 'カット', durationMinutes: 60,
          bufferAfterMinutes: 0, basePrice: 8000, priceMode: 'fixed',
        },
      }),
    })
    render(<Page />)
    await flush()
    expect(screen.queryByText('予約した時の内容')).toBeNull()
  })

  it('メニューを変えた後だけ写しが出る', async () => {
    m.get.mockResolvedValue({
      booking: booking({
        menuName: 'カット（新）',
        price: 9000,
        menuSnapshot: {
          version: 1, name: 'カット', durationMinutes: 60,
          bufferAfterMinutes: 0, basePrice: 8000, priceMode: 'fixed',
        },
      }),
    })
    render(<Page />)
    await flush()
    expect(screen.getByText('予約した時の内容')).toBeTruthy()
    expect(screen.getByText('カット（第1版の内容）')).toBeTruthy()
  })
})
