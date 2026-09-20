// @vitest-environment happy-dom
/*
 * DEEP-18 / DEEP-19 / DEEP-20 (#995): 予約詳細の対象固定と通知表示。
 *
 * 監査の再現試験 (audit-deep-booking-detail.test.tsx) が示した事故を、
 * 実物の React で描いて直っていることを確かめる。
 *
 *   - 取得失敗・遅延のあとに前の予約を「今の予約」として出さない
 *     （アカウント×予約ID×要求世代で固定する）
 *   - 監査ログ0件の予約に、連携状態だけから「通知を送信しました」をでっち上げない
 *   - 確認窓の説明が操作と通知方針ごとの実処理と一致する
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  },
}))

import Page from './page'

const booking = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: name,
  menuId: `menu-${name}`,
  menuName: `${name}メニュー`,
  staffId: 'staff',
  staffName: '担当',
  status: 'requested',
  price: 0,
  startsAt: '2026-09-20T01:00:00Z',
  endsAt: '2026-09-20T02:00:00Z',
  requestedAt: '2026-09-19T01:00:00Z',
  source: 'liff',
  customer: { displayName: `${name}顧客`, isLineLinked: true, friendId: null, phone: null },
  notificationPolicy: { send_line_confirmation: false, day_before: false, hours_before: false },
  history: [],
  operations: [],
  reminders: [],
  auditLogs: [],
  lockVersion: 1,
  ...overrides,
})

const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  m.account = 'A'
  m.id = 'one'
})

describe('DEEP-18: 詳細と操作対象の固定', () => {
  it('別アカウントの取得に失敗したら、前の予約と承認ボタンを残さない', async () => {
    m.get
      .mockResolvedValueOnce({ booking: booking('A') })
      .mockRejectedValueOnce(new Error('404'))
    const v = render(<Page />)
    await flush()
    expect(screen.getByText('Aメニュー')).toBeTruthy()

    m.account = 'B'
    await act(async () => { v.rerender(<Page />) })
    await flush()

    // A の予約も、A を対象にした承認ボタンも残らない。
    expect(screen.queryByText('Aメニュー')).toBeNull()
    expect(screen.queryByRole('button', { name: /承認する/ })).toBeNull()
    expect(screen.getByText('読み込みに失敗しました')).toBeTruthy()
    expect(screen.getByText(/予約を読み込めませんでした/)).toBeTruthy()
  })

  it('遅れて届いた古い詳細で、今見ている予約を上書きしない', async () => {
    let resolveA: ((v: unknown) => void) | undefined
    m.get
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r }))
      .mockResolvedValueOnce({ booking: booking('B') })
    const v = render(<Page />)
    await flush()

    m.id = 'two'
    await act(async () => { v.rerender(<Page />) })
    await flush()
    expect(screen.getByText('Bメニュー')).toBeTruthy()

    await act(async () => resolveA?.({ booking: booking('A') }))
    expect(screen.getByText('Bメニュー')).toBeTruthy()
    expect(screen.queryByText('Aメニュー')).toBeNull()
  })

  it('対象が変わった直後は前の詳細を出さず、次の取得を待つ', async () => {
    m.get
      .mockResolvedValueOnce({ booking: booking('A') })
      .mockImplementationOnce(() => new Promise(() => {}))
    const v = render(<Page />)
    await flush()
    expect(screen.getByText('Aメニュー')).toBeTruthy()

    m.id = 'two'
    await act(async () => { v.rerender(<Page />) })

    // 取得が終わっていない間は A の内容も承認ボタンも出さない。
    expect(screen.queryByText('Aメニュー')).toBeNull()
    expect(screen.queryByRole('button', { name: /承認する/ })).toBeNull()
    expect(screen.getByText('読み込み中...')).toBeTruthy()
  })
})

describe('DEEP-19: 記録の無い予約に送信済みを書かない', () => {
  it('監査0件・通知OFFでも「送信しました」と表示せず、履歴なしと書く', async () => {
    m.get.mockResolvedValue({ booking: booking('A') })
    render(<Page />)
    await flush()
    expect(screen.queryByText('受付のお知らせを自動送信しました')).toBeNull()
    expect(screen.getByText('お客様が予約を申し込みました')).toBeTruthy()
    expect(screen.getByText('通知履歴はありません。')).toBeTruthy()
  })

  it('通知実行台帳に失敗があれば、推測ではなく失敗の事実を出す', async () => {
    m.get.mockResolvedValue({
      booking: booking('A', {
        operations: [{
          id: 'op-1',
          kind: 'confirmation_line',
          status: 'permanent_failed',
          scheduledAt: '2026-09-19T01:00:00Z',
          completedAt: '2026-09-19T01:00:05Z',
          openedAt: null,
          result: { notificationKind: 'requested' },
          errorCode: 'LineApiError',
        }],
      }),
    })
    render(<Page />)
    await flush()
    expect(screen.getByText('受付のお知らせの送信に失敗しました')).toBeTruthy()
    expect(screen.queryByText('通知履歴はありません。')).toBeNull()
  })

  it('スタッフ代理登録の予約は「お客様が申し込みました」と言い切らない', async () => {
    m.get.mockResolvedValue({ booking: booking('A', { source: 'operator' }) })
    render(<Page />)
    await flush()
    expect(screen.getByText('スタッフが予約を記録しました')).toBeTruthy()
    expect(screen.queryByText('お客様が予約を申し込みました')).toBeNull()
  })
})

describe('DEEP-20: 確認窓の説明を実処理に合わせる', () => {
  it('確定のお知らせOFFなら、承認してもLINEが届かないことを確認窓で伝える', async () => {
    m.get.mockResolvedValue({ booking: booking('A') })
    render(<Page />)
    await flush()
    expect(screen.getByText('この予約は確定のお知らせを送らない設定です。承認してもLINEには届きません。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '承認する' }))
    await flush()
    // ボタン横の案内と確認窓の説明、両方に届かないことを書く。
    expect(screen.getAllByText(/承認してもLINEには届きません/).length).toBeGreaterThan(1)
    expect(screen.queryByText(/この結果がLINEで届きます/)).toBeNull()
  })

  it('確定のお知らせONなら、届くことを伝える', async () => {
    m.get.mockResolvedValue({
      booking: booking('A', {
        notificationPolicy: { send_line_confirmation: true, day_before: true, hours_before: true },
      }),
    })
    render(<Page />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '承認する' }))
    await flush()
    expect(screen.getByText(/確定のお知らせがお客様のLINEへ届きます/)).toBeTruthy()
  })

  it('キャンセルは自動連絡が無い操作として説明する', async () => {
    m.get.mockResolvedValue({ booking: booking('A', { status: 'confirmed' }) })
    render(<Page />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await flush()
    expect(screen.getByText(/キャンセルしてもお客様への自動連絡はありません/)).toBeTruthy()
    expect(screen.queryByText(/この結果がLINEで届きます/)).toBeNull()
  })

  it('LINE未連携なら、どの操作でも自動連絡が無いことを伝える', async () => {
    m.get.mockResolvedValue({
      booking: booking('A', {
        customer: { displayName: 'A顧客', isLineLinked: false, friendId: null, phone: '末尾 1234' },
      }),
    })
    render(<Page />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '承認する' }))
    await flush()
    // ボタン横の案内と確認窓の説明、両方に自動連絡が無いことを書く。
    expect(
      screen.getAllByText(/LINEと結びついていないため、お客様への自動連絡はありません/).length,
    ).toBeGreaterThan(1)
  })
})
