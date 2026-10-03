// @vitest-environment happy-dom
// 時間帯の表示は端末の時計に従う。板どおりの JST で固定する。
process.env.TZ = 'Asia/Tokyo'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), updateInventory: vi.fn() }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))

import { ApiError } from '@/lib/api'
import InventoryV8 from './inventory'

const store = { id: 'store-1', organization_id: 'org-1', name: '渋谷店', code: 'SHIBUYA', area: null, capacity: 26, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'unconfigured', line_account_id: 'account-1', line_account_name: '渋谷' }
const tables = [
  { id: 't1', store_id: 'store-1', code: 'T1', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 },
  { id: 'pa', store_id: 'store-1', code: '個室A', label: '個室', seat_type: 'private_room', min_capacity: 4, max_capacity: 8, floor_x: 0, floor_y: 1, join_group: null, is_active: 1 },
  { id: 'pb', store_id: 'store-1', code: '個室B', label: '個室', seat_type: 'private_room', min_capacity: 4, max_capacity: 8, floor_x: 1, floor_y: 1, join_group: null, is_active: 0 },
]
const inventory = [
  { id: 's1', store_id: 'store-1', starts_at: '2026-10-02T17:00:00+09:00', slot_minutes: 30, total_capacity: 10, ota_capacity: 3, line_capacity: 2, walk_in_capacity: 2, reserved_count: 3 },
  { id: 's2', store_id: 'store-1', starts_at: '2026-10-02T19:00:00+09:00', slot_minutes: 30, total_capacity: 10, ota_capacity: 8, line_capacity: 6, walk_in_capacity: 6, reserved_count: 8 },
]
const reservations = [
  { id: 'r1', store_id: 'store-1', store_name: '渋谷店', source: 'line', external_id: null, customer_name: '佐藤', customer_phone: null, line_uid: null, guest_count: 4, starts_at: '2026-10-02T19:00:00+09:00', ends_at: '2026-10-02T21:00:00+09:00', table_id: 'pa', table_label: '個室A', course_id: null, course_name: null, status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
]
const data = {
  organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: 'テスト組織', status: 'active' },
  stores: [store], memberships: [], tables, menuItems: [], reservations, reservationTotal: 1, inventory, approvals: [], connectors: [], reviews: [], posts: [], lineFlows: [],
}

beforeEach(() => {
  fixture.snapshot.mockResolvedValue({ data })
  fixture.updateInventory.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

/*
 * ★V8-B 予約枠・在庫（板 `Y8SjT2`・競合 `qf3ky`）の契約。
 * 配分・卓の埋まりぐあい・在庫の表・行の箱・固定帯が出て、
 * 操作が今の口へ届くこと、競合の帯が出ることを固定する。
 */
describe('Y8SjT2 予約枠・在庫のV8', () => {
  it('配分と在庫の表・卓・固定帯が出る', async () => {
    render(<InventoryV8 />)
    await screen.findByText('席と枠の配分（卓とつながる）')
    const board = document.querySelector('[data-design-node="Y8SjT2"]')!
    expect(board.textContent).toContain('1つの時間帯の総数 10席')
    expect(board.textContent).toContain('個室Bは停止中のため除く')
    expect(board.textContent).toContain('時間帯ごとの在庫')
    expect(board.textContent).toContain('個室A')
    expect(board.textContent).toContain('配分を保存')
  })

  it('行を押すとその時間帯の箱が出て保存が今の口へ届く', async () => {
    render(<InventoryV8 />)
    await screen.findByText('席と枠の配分（卓とつながる）')
    fireEvent.click(screen.getByRole('button', { name: '17:00' }))
    expect(screen.getByText('行を押したときと：17:00の配分だけ直す')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'この時間帯だけ保存' }))
    await waitFor(() => expect(fixture.updateInventory).toHaveBeenCalledWith('account-1', 's1', expect.objectContaining({ otaCapacity: 3 })))
  })

  it('競合（409）のとき黄色の帯と比べる窓が出る', async () => {
    fixture.updateInventory.mockRejectedValueOnce(new ApiError(409, '競合しました', 'conflict'))
    render(<InventoryV8 />)
    await screen.findByText('席と枠の配分（卓とつながる）')
    fireEvent.click(screen.getByRole('button', { name: '配分を保存' }))
    await screen.findByText('ほかの担当者が先に保存しました')
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    expect(screen.getByText('保存しようとした配分と最新の配分')).not.toBeNull()
  })
})
