// @vitest-environment happy-dom
/*
 * IDEA-27 (#1045): 予約詳細への「まとめ」と履歴の追加取得。
 *
 *   - 顧客情報（タグ・マイル・前回の申し送り・これまでの予約）を詳細にまとめる
 *   - 未確認・要対応のことを1か所に集めて見せる
 *   - 変更履歴の初期表示は要点分だけ。残りは audit-logs 口から追加取得し、
 *     取り損ねても表示済みを消さず再試行できる
 *   - 予約を切り替えたら追加取得した履歴も残さない（混在しない）
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  account: 'A',
  id: 'one',
  get: vi.fn(),
  getAuditLogs: vi.fn(),
}))

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
    getAuditLogs: m.getAuditLogs,
  },
}))

import Page from './page'

const auditLog = (id: string, text: string, occurredAt: string) => ({
  id,
  action: 'updated',
  before: null,
  after: { internal_note: text },
  reason: null,
  actorType: 'staff' as const,
  actorId: null,
  actorName: '担当',
  occurredAt,
})

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 'one',
  menuId: 'menu-1',
  menuName: 'カット',
  staffId: 'staff-1',
  staffName: '担当',
  status: 'confirmed',
  price: 5000,
  startsAt: '2026-09-20T01:00:00Z',
  endsAt: '2026-09-20T02:00:00Z',
  requestedAt: '2026-09-19T01:00:00Z',
  decidedAt: '2026-09-19T02:00:00Z',
  source: 'liff',
  customerNote: null,
  internalNote: null,
  calendarSync: 'synced' as const,
  customer: {
    displayName: '山田',
    isLineLinked: true,
    friendId: 'friend-1',
    bookingCustomerId: null,
    phone: '末尾 1234',
    petName: null,
    tags: [],
    mileageBalance: null,
  },
  previousHandover: null,
  notificationPolicy: { send_line_confirmation: true, day_before: true, hours_before: true },
  history: [],
  operations: [],
  reminders: [],
  auditLogs: [],
  auditLogTotal: 0,
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

describe('IDEA-27: 顧客情報のまとめ', () => {
  it('タグ・マイル・前回の申し送り・これまでの予約を詳細にまとめる', async () => {
    m.get.mockResolvedValue({
      booking: booking({
        customer: {
          displayName: '山田',
          isLineLinked: true,
          friendId: 'friend-1',
          bookingCustomerId: null,
          phone: '末尾 1234',
          petName: 'ポチ',
          tags: [{ id: 't1', name: '常連' }],
          mileageBalance: 120,
        },
        previousHandover: '足を触る前に声をかける',
        history: [
          {
            id: 'old-1',
            startsAt: '2026-08-01T01:00:00Z',
            status: 'completed',
            customerNote: null,
            handoverNote: null,
            price: 5000,
            menuName: 'カット',
            staffName: '担当',
          },
        ],
      }),
    })
    render(<Page />)
    await flush()

    expect(screen.getByText('常連')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('足を触る前に声をかける')).toBeTruthy()
    // 初期表示は件数だけ。内訳は開いてから見せる。
    expect(screen.getByText(/1件/)).toBeTruthy()
    expect(screen.queryByText('カット／担当')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '内訳を見る' }))
    await flush()
    expect(screen.getByText('カット／担当')).toBeTruthy()
  })
})

describe('IDEA-27: 確認が必要なことのまとめ', () => {
  it('未承認・要望・申し送り・失敗した処理を1か所に集める', async () => {
    m.get.mockResolvedValue({
      booking: booking({
        status: 'requested',
        customerNote: '短めでお願いします',
        previousHandover: '前回は遅れて来店',
        calendarSync: 'failed',
        operations: [
          {
            id: 'op-1',
            kind: 'confirmation_line',
            status: 'permanent_failed',
            scheduledAt: '2026-09-19T01:00:00Z',
            completedAt: null,
            openedAt: null,
            result: { notificationKind: 'requested' },
            errorCode: 'LineApiError',
          },
        ],
      }),
    })
    render(<Page />)
    await flush()

    expect(screen.getByText('確認が必要なこと')).toBeTruthy()
    expect(screen.getByText('まだ承認・お断りの判断をしていません')).toBeTruthy()
    expect(screen.getByText(/お客様からの要望があります/)).toBeTruthy()
    expect(screen.getByText('前回の来店時の申し送りがあります')).toBeTruthy()
    expect(screen.getByText('Googleカレンダーに反映できていません')).toBeTruthy()
    expect(screen.getByText('届いていないお知らせが1件あります')).toBeTruthy()
  })

  it('確認することが無い予約では「ありません」とだけ言う', async () => {
    m.get.mockResolvedValue({ booking: booking() })
    render(<Page />)
    await flush()
    expect(screen.getByText('確認が必要なことはありません。')).toBeTruthy()
  })
})

describe('IDEA-27: 長い変更履歴は追加取得する', () => {
  it('要点分を先に出し、残りはボタンで取得して繋げる', async () => {
    m.get.mockResolvedValue({
      booking: booking({
        auditLogTotal: 4,
        auditLogs: [
          auditLog('log-4', '4件目', '2026-09-19T04:00:00Z'),
          auditLog('log-3', '3件目', '2026-09-19T03:00:00Z'),
        ],
      }),
    })
    m.getAuditLogs.mockResolvedValue({
      audit_logs: [
        auditLog('log-4', '4件目', '2026-09-19T04:00:00Z'),
        auditLog('log-3', '3件目', '2026-09-19T03:00:00Z'),
        auditLog('log-2', '2件目', '2026-09-19T02:00:00Z'),
        auditLog('log-1', '1件目', '2026-09-19T01:00:00Z'),
      ],
    })
    render(<Page />)
    await flush()

    // 初期は要点分だけ。残りの件数をボタンに書く。
    expect(screen.getByText('あと2件の記録を読み込む')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /記録を読み込む/ }))
    await flush()

    expect(m.getAuditLogs).toHaveBeenCalledWith('A', 'one', 200)
    // id で重複を潰して繋ぐので、同じ記録は1回だけ出る。
    expect(screen.getAllByText(/を変更しました/).length).toBe(4)
    expect(screen.queryByText(/記録を読み込む/)).toBeNull()
  })

  it('追加取得に失敗しても表示済みを消さず、もう一度試せる', async () => {
    m.get.mockResolvedValue({
      booking: booking({
        auditLogTotal: 3,
        auditLogs: [auditLog('log-3', '3件目', '2026-09-19T03:00:00Z')],
      }),
    })
    m.getAuditLogs
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        audit_logs: [
          auditLog('log-3', '3件目', '2026-09-19T03:00:00Z'),
          auditLog('log-2', '2件目', '2026-09-19T02:00:00Z'),
          auditLog('log-1', '1件目', '2026-09-19T01:00:00Z'),
        ],
      })
    render(<Page />)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: /記録を読み込む/ }))
    await flush()
    expect(screen.getByText(/記録を読み込めませんでした/)).toBeTruthy()
    // 表示済みの要点分は残したまま。
    expect(screen.getByText(/を変更しました/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /記録を読み込む/ }))
    await flush()
    expect(screen.getAllByText(/を変更しました/).length).toBe(3)
  })

  it('予約を切り替えたら、前の予約の追加履歴を残さない', async () => {
    m.get
      .mockResolvedValueOnce({
        booking: booking({
          id: 'one',
          auditLogTotal: 3,
          auditLogs: [auditLog('log-3', '3件目', '2026-09-19T03:00:00Z')],
        }),
      })
      .mockResolvedValueOnce({
        booking: booking({ id: 'two', auditLogTotal: 1, auditLogs: [auditLog('log-x', '別予約', '2026-09-18T01:00:00Z')] }),
      })
    m.getAuditLogs.mockResolvedValue({
      audit_logs: [
        auditLog('log-3', '3件目', '2026-09-19T03:00:00Z'),
        auditLog('log-2', '2件目', '2026-09-19T02:00:00Z'),
        auditLog('log-1', '1件目', '2026-09-19T01:00:00Z'),
      ],
    })
    const v = render(<Page />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /記録を読み込む/ }))
    await flush()
    expect(screen.getAllByText(/を変更しました/).length).toBe(3)

    m.id = 'two'
    await act(async () => { v.rerender(<Page />) })
    await flush()

    // 前の予約で追加取得した履歴は残らず、今の予約の要点分だけ出る。
    expect(screen.getAllByText(/を変更しました/).length).toBe(1)
    expect(screen.queryByText(/記録を読み込む/)).toBeNull()
  })
})
