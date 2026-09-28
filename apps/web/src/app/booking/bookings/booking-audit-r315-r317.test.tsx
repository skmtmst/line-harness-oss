// @vitest-environment happy-dom
/*
 * 監査 R315・R316・R317（予約台帳）を実描画で固定する。
 * - R315: 表示切替・状態・期間の選択を aria-pressed で伝え、空き枠リンクに
 *   日付・開始時刻・担当を含む固有の名前を付ける。
 * - R316: 集計・注意の見出しは選んだ日・週そのものを名指しする。
 *   「今日」「今週」は重なるときだけ添える。
 * - R317: 表示方法・対象日・絞り込み・ページをURLへ写し、再読み込みと
 *   入力画面からの復帰で同じ状態に戻す。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BookingCalendar, { slotAriaLabel, startOfWeek, type CalendarSlot } from './booking-calendar'
import type { BookingRequest } from '@/lib/api'

const nav = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
}))

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
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
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

function slot(over: Partial<CalendarSlot> = {}): CalendarSlot {
  return {
    staffId: 's1',
    staffName: '山田',
    menuId: 'm1',
    date: '2026-09-28',
    start: '10:30',
    end: '11:00',
    startUtc: '2026-09-28T10:30:00+09:00',
    endUtc: '2026-09-28T11:00:00+09:00',
    remaining: 1,
    state: 'available',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  nav.search = ''
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

describe('監査 R315: 選択状態を意味で伝える', () => {
  it('表示切替（今日・今週・今月・一覧）は押下状態を持つ', async () => {
    render(<BookingsPage />)
    const listTab = await screen.findByRole('button', { name: '一覧' })
    // 初期表示は「日」なので一覧は押されていない。
    expect(listTab.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(listTab)
    expect(listTab.getAttribute('aria-pressed')).toBe('true')
    // 既存操作は維持する。一覧へ切り替わり、検索欄が出る。
    expect(await screen.findByPlaceholderText('お客さま名で検索')).toBeTruthy()
  })

  it('状態と期間の絞り込みは押下状態を持つ', async () => {
    nav.search = 'view=list'
    render(<BookingsPage />)
    const done = await screen.findByRole('button', { name: '完了' })
    expect(done.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(done)
    expect(done.getAttribute('aria-pressed')).toBe('true')
    // 今日・今週の期間ボタンも同じ約束。
    const today = screen.getByRole('button', { name: '今日' })
    expect(today.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(today)
    expect(today.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('監査 R315: 空き枠リンクは日時と担当で区別できる', () => {
  it('読み上げ名に日付・開始時刻・担当が入る', () => {
    expect(slotAriaLabel({ day: '2026-09-29', time: '10:00', staffName: '山田' })).toMatch(/9月29日.*10:00.*山田.*空きあり/)
  })

  it('2枠の名前が重ならない', () => {
    render(
      <BookingCalendar
        mode="day"
        items={[]}
        onOpen={() => {}}
        staffNames={['山田']}
        canCreate
        anchorDay="2026-09-28"
        onAnchorChange={() => {}}
        availability={{
          status: 'ready',
          slots: [
            slot({ start: '10:30', end: '11:00', startUtc: '2026-09-28T10:30:00+09:00', endUtc: '2026-09-28T11:00:00+09:00' }),
            slot({ start: '11:00', end: '11:30', startUtc: '2026-09-28T11:00:00+09:00', endUtc: '2026-09-28T11:30:00+09:00' }),
          ],
        }}
      />,
    )
    const links = screen.getAllByRole('link', { name: /空きあり/ })
    expect(links).toHaveLength(2)
    const names = links.map((link) => link.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(2)
    for (const name of names) {
      expect(name).toMatch(/9月28日/)
      expect(name).toMatch(/山田/)
    }
  })
})

describe('監査 R316: 集計の見出しは選んだ期間を名指しする', () => {
  it('翌日の日表示では「今日の予約」にならない', () => {
    render(
      <BookingCalendar
        mode="day"
        items={[]}
        onOpen={() => {}}
        staffNames={['山田']}
        anchorDay="2026-09-30"
        onAnchorChange={() => {}}
        availability={{ status: 'ready', slots: [] }}
      />,
    )
    // 9月30日の予約件数の見出し。今日・昨日・翌日のどれでも同じ約束。
    expect(screen.getByText(/9月30日.*の予約/)).toBeTruthy()
    expect(screen.queryByText('今日の予約')).toBeNull()
    expect(screen.queryByText('今日 気をつけること')).toBeNull()
    expect(screen.queryByText('今日の流れ')).toBeNull()
    expect(screen.getByText(/9月30日.*気をつけること/)).toBeTruthy()
  })

  it('今日の日表示では「今日」を添える', () => {
    render(
      <BookingCalendar
        mode="day"
        items={[]}
        onOpen={() => {}}
        staffNames={['山田']}
        anchorDay={todayJst}
        onAnchorChange={() => {}}
        availability={{ status: 'ready', slots: [] }}
      />,
    )
    expect(screen.getByText(/今日（.*）の予約/)).toBeTruthy()
  })

  it('翌週の週表示では週の範囲を名指しする', () => {
    // 今日を含まない固定の週（2026-10-05の週）で確かめる。
    const anchor = '2026-10-05'
    const start = startOfWeek(anchor)
    render(
      <BookingCalendar
        mode="week"
        items={[]}
        onOpen={() => {}}
        staffNames={['山田']}
        anchorDay={anchor}
        onAnchorChange={() => {}}
        availability={{ status: 'ready', slots: [] }}
      />,
    )
    expect(start).toBe('2026-10-05')
    expect(screen.getByText(/10\/5〜10\/11 の週.*の予約/)).toBeTruthy()
    expect(screen.queryByText('今週の予約')).toBeNull()
    expect(screen.queryByText('今週 気をつけること')).toBeNull()
  })
})

describe('監査 R317: 条件と表示日をURLへ持ち、再読み込みで復元する', () => {
  it('URLの表示方法・絞り込み・検索語で一覧を開く', async () => {
    nav.search = 'view=list&status=completed&range=week&q=QA_R317'
    render(<BookingsPage />)
    await waitFor(() => {
      const calls = fixture.listRequests.mock.calls as Array<[string, string, Record<string, unknown>]>
      const restored = calls.find(([, status, params]) => status === 'completed' && params?.query === 'QA_R317')
      expect(restored).toBeTruthy()
    })
    // 検索欄にも戻り、運用者が条件を見失わない。
    expect((screen.getByPlaceholderText('お客さま名で検索') as HTMLInputElement).value).toBe('QA_R317')
    // 状態をURLへ写す（再読み込みで同じになる）。
    await waitFor(() => {
      const writes = nav.replace.mock.calls.map((call) => String(call[0]))
      expect(writes.some((url) => url.includes('view=list') && url.includes('status=completed') && url.includes('q=QA_R317'))).toBe(true)
    })
  })

  it('URLの日付でカレンダーの表示日を開く', async () => {
    nav.search = 'view=day&date=2026-09-30'
    render(<BookingsPage />)
    // カレンダーの枠題が9月30日になる（「今日」のままではない）。
    expect((await screen.findAllByText(/9月30日/)).length).toBeGreaterThan(0)
    expect(screen.queryByText('今日の予約')).toBeNull()
  })

  it('条件を持たないURLでは同じタブの保存へ戻す', async () => {
    window.sessionStorage.setItem(
      'booking-ledger-state-v1',
      JSON.stringify({
        view: 'list', status: 'completed', range: 'all', date: todayJst,
        q: '保存条件', menu: 'all', staff: 'all', source: 'all', page: '1',
      }),
    )
    nav.search = ''
    render(<BookingsPage />)
    await waitFor(() => {
      const calls = fixture.listRequests.mock.calls as Array<[string, string, Record<string, unknown>]>
      const restored = calls.find(([, status, params]) => status === 'completed' && params?.query === '保存条件')
      expect(restored).toBeTruthy()
    })
  })

  it('絞り込みを変えるとURLへ写り、明示の解除で既定へ戻る', async () => {
    // 完了に絞ると0件になり、絞り込みの解除ボタンが出る。
    fixture.listRequests.mockImplementation(async (_account: string, status: string) =>
      status === 'completed' || status === 'all'
        ? { requests: [], total: 0 }
        : { requests: [requestedBooking], total: 1 },
    )
    nav.search = 'view=list'
    render(<BookingsPage />)
    const done = await screen.findByRole('button', { name: '完了' })
    fireEvent.click(done)
    await waitFor(() => {
      const writes = nav.replace.mock.calls.map((call) => String(call[0]))
      expect(writes.some((url) => url.includes('status=completed'))).toBe(true)
    })
    // 明示の解除だけが初期化する。解除後は未承認・条件なしへ戻る。
    fireEvent.click(screen.getByRole('button', { name: '絞り込みを解除' }))
    await waitFor(() => {
      const writes = nav.replace.mock.calls.map((call) => String(call[0]))
      expect(writes.some((url) => url.includes('status=all'))).toBe(true)
    })
  })
})
