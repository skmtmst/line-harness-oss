// @vitest-environment happy-dom
/*
 * #634: 予約管理の空き枠・一覧の失敗表示から、その場で読み直せる。
 *
 * 監査の実測で、集計・メニュー・担当の取得が失敗すると
 * 「空き枠を読み込めませんでした」の帯が出るが、直す道はページ全体を
 * 開き直す以外に無かった。
 *
 * ここでは実物の BookingsPage を mount し、失敗→「もう一度読み込む」→
 * 同じ取得列がもう一度走って帯が消える、を実DOMで固定する。
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
  useSearchParams: () => new URLSearchParams(),
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
  // 権限の判定は対象外。閲覧のみの人と同じ扱いで落とす。
  fixture.staffMe.mockResolvedValue({ success: false })
  fixture.listRequests.mockResolvedValue({ requests: [], total: 0 })
  fixture.requestsSummary.mockResolvedValue(summary)
  fixture.listMenus.mockResolvedValue({ menus: [menu] })
  fixture.listStaff.mockResolvedValue({ staff: [staff] })
  fixture.availabilityBatch.mockResolvedValue({ by_menu: [] })
})

afterEach(cleanup)

describe('#634 予約管理の空き枠・一覧の再読み込み', () => {
  it('集計・メニュー・担当の取得失敗から「もう一度読み込む」で取り直す', async () => {
    fixture.requestsSummary.mockRejectedValueOnce(new Error('down'))
    fixture.listMenus.mockRejectedValueOnce(new Error('down'))
    fixture.listStaff.mockRejectedValueOnce(new Error('down'))

    render(<BookingsPage />)

    // 失敗の帯と、その中の読み直す口が出る。
    await waitFor(() => expect(screen.getByText(/予約の記録だけを表示しています/)).toBeTruthy())
    const retry = screen.getByRole('button', { name: 'もう一度読み込む' })

    fireEvent.click(retry)

    // 同じ取得列がもう一度走り、届けば失敗の帯は消える。
    await waitFor(() => expect(fixture.requestsSummary).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(fixture.listMenus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/予約の記録だけを表示しています/)).toBeNull())
    await waitFor(() => expect(screen.getAllByText('実際に受け付けられる枠を数えています').length).toBeGreaterThan(0))
  })

  it('一覧自体の失敗表示にも読み直す口を出す', async () => {
    fixture.listRequests.mockRejectedValueOnce(new Error('一覧down'))

    render(<BookingsPage />)

    await waitFor(() => expect(screen.getByText('一覧down')).toBeTruthy())
    const retries = screen.getAllByRole('button', { name: 'もう一度読み込む' })
    expect(retries.length).toBeGreaterThan(0)

    fireEvent.click(retries[0])

    await waitFor(() => expect(fixture.listRequests).toHaveBeenCalledTimes(3))
  })
})
