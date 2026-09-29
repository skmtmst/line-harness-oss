// @vitest-environment happy-dom
/*
 * 監査 R89・R90（予約一覧）を実描画で固定する。
 * - R89: 承認の後は一覧だけでなく集計・カレンダー・空き枠も読み直す。
 * - R90: 「今月」を押すと今月の初め〜来月の初めで絞り、対象を明示する。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BookingRequest } from '@/lib/api'

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
  total: 1, requested: 1, monthTotal: 1, monthConfirmed: 0,
  monthCancelled: 0, lastMonthTotal: 0, todayTotal: 0, weekTotal: 0,
  byMenu: [] as Array<{ name: string; total: number }>,
}

// カレンダーの基点（今日・JST）に合わせる。固定日にすると実行日で消える。
const todayJst = new Date(new Date().getTime() + 9 * 3600_000).toISOString().slice(0, 10)

const requestedBooking: BookingRequest = {
  id: 'b-req',
  friend_id: 'f1',
  booking_customer_id: null,
  starts_at: `${todayJst}T10:00:00+09:00`,
  ends_at: `${todayJst}T10:30:00+09:00`,
  status: 'requested',
  customer_note: null,
  internal_note: null,
  price_at_booking: 5000,
  menu_name: 'カット',
  staff_name: '山田',
  friend_name: '花子',
  requested_at: '2026-09-27T00:00:00Z',
  decided_at: null,
  external_event_id: null,
  staff_id: 'staff-1',
  source: 'liff',
}

const menu = { id: 'menu-1', name: 'カット', is_active: 1, duration_minutes: 30 }
const staff = { id: 'staff-1', display_name: '山田', is_active: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  // R317: 台帳は同じタブの保存へ条件を残す。新しいタブ相当の前提にする。
  window.sessionStorage.clear()
  fixture.staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
  fixture.listRequests.mockResolvedValue({ requests: [requestedBooking], total: 1 })
  fixture.requestsSummary.mockResolvedValue(summary)
  fixture.listMenus.mockResolvedValue({ menus: [menu] })
  fixture.listStaff.mockResolvedValue({ staff: [staff] })
  fixture.availabilityBatch.mockResolvedValue({ by_menu: [] })
  fixture.getBooking.mockResolvedValue({ booking: null })
  fixture.decideRequest.mockResolvedValue({})
})

afterEach(cleanup)

function monthBounds(): { from: string; to: string } {
  const now = new Date(Date.now() + 9 * 3600_000)
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 7)
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString().slice(0, 7)
  return {
    from: new Date(`${thisMonth}-01T00:00:00+09:00`).toISOString(),
    to: new Date(`${nextMonth}-01T00:00:00+09:00`).toISOString(),
  }
}

describe('監査 R90: 今月は今月の予約に絞る', () => {
  it('今月タブで一覧の取得に今月の初め〜来月の初めが入る', async () => {
    render(<BookingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /^今月/ }))
    const { from, to } = monthBounds()
    await waitFor(() => {
      const calls = fixture.listRequests.mock.calls as Array<[string, string, Record<string, unknown>]>
      const monthCall = calls.find(([, , params]) => params?.from === from && params?.to === to)
      expect(monthCall).toBeTruthy()
    })
    // 対象の期間と状態を画面に明示する。
    expect(screen.getByRole('status').textContent).toMatch(/今月（\d+年\d+月）の予約を/)
  })
})

describe('タブの数は期間の有効な予約だけ（取消・拒否・期限切れを除く）', () => {
  it('集計のタブ用があれば従来の総数より絞って出す', async () => {
    // 撮影の「今日 6・今週 6・今月 6」と0件のずれ。タブは未絞りの総数ではなく
    // 有効な予約の数を出す。旧Worker（タブ用なし）では従来の数に倒す。
    fixture.requestsSummary.mockResolvedValue({
      ...summary,
      todayTotal: 5, todayTabTotal: 2,
      weekTotal: 6, weekTabTotal: 3,
      monthTotal: 7, monthTabTotal: 4,
    })
    render(<BookingsPage />)
    expect(await screen.findByRole('button', { name: '今日 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '今週 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '今月 4' })).toBeTruthy()
  })
})

describe('監査 R89: 承認の後は集計・カレンダーも更新する', () => {
  it('状態の確定で一覧・集計・カレンダーの取得が走り直す', async () => {
    // 日の表示のまま。カレンダーのマス→詳細→完了の順に押す。
    render(<BookingsPage />)
    const card = await screen.findByRole('button', { name: /カットの詳細/ })
    const listBefore = fixture.listRequests.mock.calls.length
    const summaryBefore = fixture.requestsSummary.mock.calls.length
    fireEvent.click(card)
    const complete = await screen.findByRole('button', { name: '来ていただきました にする' })
    fireEvent.click(complete)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '完了' }))
    await waitFor(() => {
      expect(fixture.decideRequest).toHaveBeenCalledWith('account-a', 'b-req', 'complete')
    })
    // 一覧・集計・カレンダー（'all'＋期間の取得）の取り直しが走る。
    await waitFor(() => {
      expect(fixture.listRequests.mock.calls.length).toBeGreaterThan(listBefore)
      expect(fixture.requestsSummary.mock.calls.length).toBeGreaterThan(summaryBefore)
      const calls = fixture.listRequests.mock.calls as Array<[string, string, Record<string, unknown>]>
      const calendarReload = calls
        .slice(listBefore)
        .some(([, status, params]) => status === 'all' && typeof params?.from === 'string')
      expect(calendarReload).toBe(true)
    })
  })
})
