// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  snapshot: vi.fn(), storeContext: vi.fn(), reservationsDay: vi.fn(), channelCloseTasks: vi.fn(), openingHours: vi.fn(),
  postSeatVisitMark: vi.fn(), deleteSeatVisitMark: vi.fn(), completeChannelCloseTask: vi.fn(), mediaLinks: vi.fn(),
}))
const google = vi.hoisted(() => ({ connection: vi.fn(), listReviews: vi.fn() }))
const fetchApi = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: api }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: google }))
vi.mock('@/lib/api', () => ({ fetchApi }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

import RestaurantDashboardV8 from './dashboard'
import { reservation, snapshotOf } from '../booking-kit/test-data'

const today = (hour: number) => { const d = new Date(); d.setHours(hour, 0, 0, 0); return d.toISOString() }

beforeEach(() => {
  role.value = 'owner'
  api.snapshot.mockResolvedValue({ data: snapshotOf() })
  api.storeContext.mockResolvedValue({ data: { selectedStore: { id: 'store-1', name: '渋谷店' } } })
  api.reservationsDay.mockResolvedValue({ data: { reservations: [
    reservation('r1', { customer_name: '鈴木 美咲', source: 'phone', starts_at: today(18), ends_at: today(20), status: 'confirmed' }),
    reservation('r2', { customer_name: '佐藤 健二', source: 'line', starts_at: today(17), ends_at: today(19), status: 'seated' }),
  ] } })
  api.channelCloseTasks.mockResolvedValue({ data: [
    { id: 'c1', storeId: 'store-1', slotId: 's19', startsAt: today(19), channel: 'hotpepper', status: 'close', reason: 'limited', remainingSeats: 2, recipientIds: [], createdAt: '', updatedAt: '' },
  ] })
  api.openingHours.mockResolvedValue({ data: { hours: null } })
  api.postSeatVisitMark.mockResolvedValue({ success: true })
  api.completeChannelCloseTask.mockResolvedValue({ success: true })
  fetchApi.mockResolvedValue({ data: [{ code: 'hotpepper', name: 'ホットペッパー', receiveMethod: 'email_forward' }] })
  /* 提案 E-4 の設定で保存した URL。管理画面の URL があると知らせに［…の管理画面を開く ↗］が出る。 */
  api.mediaLinks.mockResolvedValue({ data: [{ code: 'hotpepper', name: 'ホットペッパー', acceptsReservations: 1, pageUrl: 'https://hotpepper.jp/x/', loginUrl: 'https://manager.hotpepper.jp/', closeOnBooking: 1, version: 1 }] })
  google.connection.mockResolvedValue({ connection: { status: 'disconnected' }, summary: { unrepliedCount: 0 }, store: { name: '渋谷店' } })
  google.listReviews.mockResolvedValue({ reviews: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('hKRRF 今日のお店', () => {
  it('店のタブ・枠を閉じる知らせ・数・今日の予約・媒体が出て、［来店］で来店の印を付ける', async () => {
    render(<RestaurantDashboardV8 />)
    await screen.findByText('鈴木 美咲')
    const board = document.querySelector('[data-design-node="hKRRF"]')!
    for (const label of ['ダッシュボード', '予約（今日・今月・一覧）', '座席・卓', '予約枠・在庫', '今日の予約', '来店予定', '空席（いま）', '未返信の口コミ', '予約サイト・グルメ媒体', 'Instagram の新着']) {
      expect(board.textContent).toContain(label)
    }
    expect(board.textContent).toContain('他の予約サイトの枠を閉じてください（未対応 1件）')
    expect(board.textContent).toContain('ホットペッパー')
    /* 設定で保存した管理画面の URL が、知らせのボタンと右の列のリンクに使われる（提案 E-4 とのつなぎ）。 */
    expect(screen.getByRole('link', { name: 'ホットペッパーの管理画面を開く ↗' }).getAttribute('href')).toBe('https://manager.hotpepper.jp/')
    expect(screen.getByRole('link', { name: '店舗ページ ↗' }).getAttribute('href')).toBe('https://hotpepper.jp/x/')
    expect(screen.getByRole('button', { name: /電話予約/ })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '鈴木 美咲さんを来店にする' }))
    await waitFor(() => expect(api.postSeatVisitMark).toHaveBeenCalledWith('account-1', 'r1', { kind: 'visited' }))
    /* 来店済みの行には［来店］を出さない。 */
    expect(screen.queryByRole('button', { name: '佐藤 健二さんを来店にする' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ホットペッパーの枠を閉じた' }))
    await waitFor(() => expect(api.completeChannelCloseTask).toHaveBeenCalledWith('account-1', 'c1'))
  })

  it('閲覧のみには電話予約・ウォークイン・来店・閉じたのボタンを置かない', async () => {
    role.value = 'viewer'
    render(<RestaurantDashboardV8 />)
    await screen.findByText('鈴木 美咲')
    for (const name of [/電話予約/, /ウォークイン/, /来店にする/, /枠を閉じた/]) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})
