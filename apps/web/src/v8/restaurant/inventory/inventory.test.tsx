// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), inventoryDay: vi.fn(), openingHours: vi.fn(), saveOpeningHours: vi.fn(), saveInventoryAllocation: vi.fn(),
  updateInventory: vi.fn(), generateInventory: vi.fn(), listIntakeAddresses: vi.fn(), issueIntakeAddress: vi.fn(),
}))
const fetchApi = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/lib/api', async (load) => ({ ...(await load<typeof import('@/lib/api')>()), fetchApi }))

import { ApiError } from '@/lib/api'
import InventoryPage from './inventory'
import { joinTableCodes } from './format'
import { at, snapshotOf, tables } from '../booking-kit/test-data'

const slot = (id: string, hour: number, occupied: string[], seats: number, over: Record<string, unknown> = {}) => ({
  id, store_id: 'store-1', starts_at: at(0, hour), slot_minutes: 30, total_capacity: 20, ota_capacity: 8, line_capacity: 6, walk_in_capacity: 6,
  reserved_count: seats, occupied_seats: seats, occupiedTableIds: occupied, freeSeats: 20 - seats, version: 3, updated_by_name: '中川 由美', updated_at: at(0, 14, 2), ...over,
})
const days = [slot('s17', 17, ['pa'], 8), slot('s19', 19, ['pa', 't1', 't2', 't3', 't4'], 18, { ota_capacity: 6, line_capacity: 4, walk_in_capacity: 4 })]
const hours = Array.from({ length: 7 }, (_, weekday) => ({ weekday, periods: weekday === 1 ? [] : [{ opensAt: '17:00', closesAt: '22:00' }] }))
const channels = [
  { id: 'hp', code: 'hotpepper', name: 'Hot Pepper グルメ', todayCount: 9, lastReceivedAt: at(0, 18, 42), unreadableCount: 0, receiveMethod: 'email_forward', status: 'receiving', daysWithoutReceipt: 0 },
  { id: 'rt', code: 'retty', name: 'Retty', todayCount: 0, lastReceivedAt: at(-7, 12), unreadableCount: 0, receiveMethod: 'email_forward', status: 'not_receiving', daysWithoutReceipt: 7 },
  { id: 'manual', code: 'manual', name: '電話・LINE・店頭', todayCount: 4, lastReceivedAt: at(0, 17, 30), unreadableCount: 0, receiveMethod: 'manual', status: 'receiving', daysWithoutReceipt: 0 },
]

beforeEach(() => {
  role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ data: snapshotOf() })
  fixture.inventoryDay.mockResolvedValue({ data: days })
  fixture.openingHours.mockResolvedValue({ data: { storeId: 'store-1', hours, version: 4, updatedBy: 'mem-2', updatedAt: at(0, 14, 2) } })
  fixture.saveOpeningHours.mockResolvedValue({ success: true, data: { version: 5 } })
  fixture.saveInventoryAllocation.mockResolvedValue({ success: true, data: { updated: 2 } })
  fixture.updateInventory.mockResolvedValue({ success: true })
  fixture.listIntakeAddresses.mockResolvedValue({ data: [{ id: 'ia', storeId: 'store-1', localPart: 'r', address: 'r-1@in.example.jp', status: 'active', createdAt: '', revokedAt: null }] })
  fetchApi.mockImplementation(async (path: string) => (path.includes('/channels')
    ? { success: true, data: channels }
    : { success: true, data: [{ id: 'mail-1', storeId: 'store-1', receivedAt: at(0, 18, 20), status: 'quarantined', reason: '人数の欄が読めませんでした', mediaCode: 'tabelog', mediaName: '食べログ' }], total: 1 }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Y8SjT2 予約枠・在庫', () => {
  it('配分・在庫の表・いちばん混む時間の卓と「行を押したとき」の箱・開ける時間が出る', async () => {
    render(<InventoryPage />)
    await screen.findByText('19:00 の卓')
    const board = document.querySelector('[data-design-node="Y8SjT2"]')!
    expect(board.textContent).toContain('1つの時間帯の総数 20席')
    expect(board.textContent).toContain('個室A・T1〜T4')
    expect(board.textContent).toContain('行を押したとき：19:00 の配分だけ直す')
    expect(board.textContent).toContain('休み（定休日）・お客さまの画面に出ません')
  })

  it('下の帯の保存は、配分（全部の時間帯）と開ける時間を今の口へ送る', async () => {
    render(<InventoryPage />)
    await screen.findByText('19:00 の卓')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'OTA（予約媒体）' }), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /開ける時間と配分を保存/ }))
    await waitFor(() => expect(fixture.saveOpeningHours).toHaveBeenCalled())
    expect(fixture.saveInventoryAllocation).toHaveBeenCalledWith('account-1', expect.objectContaining({ storeId: 'store-1', otaCapacity: 7, slots: [{ id: 's17', expectedVersion: 3 }, { id: 's19', expectedVersion: 3 }] }))
    expect(fixture.saveOpeningHours).toHaveBeenCalledWith('account-1', expect.objectContaining({ storeId: 'store-1', expectedVersion: 4 }))
  })

  it('ほかの担当者が先に保存していたら（409）競合の帯を出し、上の帯は重ねない', async () => {
    fixture.saveInventoryAllocation.mockRejectedValue(new ApiError(409, 'conflict'))
    render(<InventoryPage />)
    await screen.findByText('19:00 の卓')
    fireEvent.click(screen.getByRole('button', { name: /開ける時間と配分を保存/ }))
    const band = await screen.findByRole('alert')
    expect(band.textContent).toContain('中川さんが 14:02 に予約枠・在庫を保存しました')
    expect(screen.getByRole('button', { name: /比べてから保存/ })).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('行を押したとき：19:00 の配分だけ直す')).toBeNull()
  })

  it('残りが少ない時間帯は、媒体を閉じる知らせ（Yyw6i）でメール転送の媒体だけに印を付けられる', async () => {
    render(<InventoryPage />)
    await screen.findByText('19:00 の卓')
    fireEvent.click(screen.getByRole('button', { name: '媒体の受付を閉じる' }))
    const dialog = document.querySelector('[data-design-node="Yyw6i"]') as HTMLElement
    expect(dialog.textContent).toContain('19:00 が残り 2 席になりました')
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1)
  })

  it('予約経路の連携（hQQlt）は媒体ごとの受け取りと読めなかったものを出す', async () => {
    render(<InventoryPage />)
    await screen.findByText('19:00 の卓')
    fireEvent.click(screen.getByRole('tab', { name: '予約経路の連携' }))
    await screen.findByText('Hot Pepper グルメ')
    expect(screen.getByText('7日届いていない')).not.toBeNull()
    expect(screen.getByText('読めなかったもの 1 件')).not.toBeNull()
    expect(screen.getByText('r-1@in.example.jp')).not.toBeNull()
  })

  it('閲覧のみ（staff）には保存の帯・時間帯の足し引きを置かない', async () => {
    role.value = 'staff'
    render(<InventoryPage />)
    await screen.findByText('19:00 の卓')
    expect(screen.queryByRole('button', { name: /開ける時間と配分を保存/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '＋ 時間帯を足す' })).toBeNull()
  })

  it('埋まっている卓は個室→テーブル→カウンターの順、3つ以上の連番は「〜」で縮める', () => {
    const pick = (codes: string[]) => tables.filter((t) => codes.includes(t.code))
    expect(joinTableCodes(pick(['T1', 'T3', 'T4', '個室A']))).toBe('個室A・T1・T3・T4')
    expect(joinTableCodes(pick(['T1', 'T2', 'T3', 'T4', '個室A']))).toBe('個室A・T1〜T4')
  })
})
