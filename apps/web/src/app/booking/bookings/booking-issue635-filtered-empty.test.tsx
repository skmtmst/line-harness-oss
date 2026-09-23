// @vitest-environment happy-dom
/*
 * #635: 予約管理の一覧で、存在しない言葉・条件に合わない絞り込みで0件に
 * なったとき、件数が減るだけでなく「条件に合う予約はありません」と
 * 次にやること（絞り込み解除）を出す。
 *
 * 監査5b_31: 一覧タブの空表示は「該当する予約はありません」の一文だけで、
 * 「まだ予約が無い」と「絞り込みで0件」の言い分けも解除導線も無かった。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  staffMe: vi.fn(),
  listRequests: vi.fn(),
  requestsSummary: vi.fn(),
  listMenus: vi.fn(),
  listStaff: vi.fn(),
  availabilityBatch: vi.fn(),
  availability: vi.fn(),
  getBooking: vi.fn(),
  decideRequest: vi.fn(),
  downloadLedgerCsv: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  // 一覧タブを最初から開いた状態にする（?view=list と同じ）。
  useSearchParams: () => new URLSearchParams('view=list'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: 'テスト店', liffId: 'liff-a' },
  }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    staff: { me: fixture.staffMe },
  },
  bookingApi: {
    listRequests: fixture.listRequests,
    requestsSummary: fixture.requestsSummary,
    listMenus: fixture.listMenus,
    listStaff: fixture.listStaff,
    getAvailabilityBatch: fixture.availabilityBatch,
    getAvailability: fixture.availability,
    getBooking: fixture.getBooking,
    decideRequest: fixture.decideRequest,
    downloadLedgerCsv: fixture.downloadLedgerCsv,
  },
}))

import BookingsPage from './page'

const summary = {
  total: 0, requested: 0, monthTotal: 0, monthConfirmed: 0,
  monthCancelled: 0, lastMonthTotal: 0, todayTotal: 0, weekTotal: 0,
  byMenu: [] as Array<{ name: string; total: number }>,
}

const menu = { id: 'menu-1', name: 'カット', is_active: 1, duration_minutes: 30 }
const staff = { id: 'staff-1', display_name: '山田', is_active: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  fixture.staffMe.mockResolvedValue({ success: false })
  fixture.listRequests.mockResolvedValue({ requests: [], total: 0 })
  fixture.requestsSummary.mockResolvedValue(summary)
  fixture.listMenus.mockResolvedValue({ menus: [menu] })
  fixture.listStaff.mockResolvedValue({ staff: [staff] })
  fixture.availabilityBatch.mockResolvedValue({ by_menu: [] })
})

afterEach(cleanup)

describe('#635 予約管理一覧の絞り込み0件', () => {
  it('予約そのものが無いときは「まだ予約はありません」を出す', async () => {
    render(<BookingsPage />)

    await waitFor(() => expect(screen.getByText('まだ予約はありません')).toBeTruthy())
    expect(screen.queryByText('条件に合う予約はありません')).toBeNull()
  })

  it('存在しない言葉で検索すると、0件の言い方と解除導線を出す', async () => {
    render(<BookingsPage />)
    await waitFor(() => expect(screen.getByText('まだ予約はありません')).toBeTruthy())

    const input = screen.getByLabelText('お客さま名で検索') as HTMLInputElement
    fireEvent.change(input, { target: { value: '存在しない言葉xyz' } })

    await waitFor(() => expect(screen.getByText('条件に合う予約はありません')).toBeTruthy())
    expect(screen.getByText('検索語や絞り込みを変えてください。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '絞り込みを解除' })).toBeTruthy()
    expect(screen.queryByText('まだ予約はありません')).toBeNull()
  })

  it('「絞り込みを解除」で検索語と状態を外して全件へ戻す', async () => {
    render(<BookingsPage />)
    await waitFor(() => expect(screen.getByText('まだ予約はありません')).toBeTruthy())

    const input = screen.getByLabelText('お客さま名で検索') as HTMLInputElement
    fireEvent.change(input, { target: { value: '存在しない言葉xyz' } })
    await waitFor(() => expect(screen.getByText('条件に合う予約はありません')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを解除' }))

    // 検索欄が空に戻り、条件なし（query 無し・全件タブ）で取り直す。
    await waitFor(() => expect(input.value).toBe(''))
    await waitFor(() => {
      const last = fixture.listRequests.mock.calls.at(-1)
      expect(last?.[1]).toBe('all')
      expect(last?.[2]?.query).toBeUndefined()
    })
    await waitFor(() => expect(screen.getByText('まだ予約はありません')).toBeTruthy())
  })
})
