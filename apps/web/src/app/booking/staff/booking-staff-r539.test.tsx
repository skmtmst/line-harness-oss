// @vitest-environment happy-dom
/*
 * R539: 予約スタッフ一覧の429は、待ち案内と一緒に画面内の再読込で
 * 取り直せる。403だけが権限案内のみで再試行の口を出さない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listStaff: vi.fn() as unknown as (...args: unknown[]) => Promise<unknown>,
}))

// 画面は localStorage の権限表を読む。happy-dom では未定義なので
// インメモリに差し替え、既定を owner（全通過）にする。
const memStorage = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
  }
})
vi.stubGlobal('localStorage', memStorage)
memStorage.setItem('lh_staff_role', 'owner')

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status?: number
  },
  bookingApi: {
    listStaff: (...args: unknown[]) => fixture.listStaff(...args),
    createStaff: vi.fn(),
    updateStaff: vi.fn(),
    deleteStaff: vi.fn(),
  },
  api: { staff: { list: async () => ({ success: true, data: [] }) } },
}))

import { ApiError as MockApiError } from '@/lib/api'
import BookingStaffPage from './page'

const ROW = {
  id: 'staff-a',
  name: 'kasei',
  display_name: '稼働さん',
  role: 'スタイリスト',
  profile_image_url: '',
  bio: '',
  sort_order: 0,
  is_designation_optional: 0,
  is_active: 1,
}

beforeEach(() => {
  fixture.listStaff = vi.fn(async () => ({ staff: [ROW] })) as unknown as typeof fixture.listStaff
})

afterEach(cleanup)

describe('R539 429は画面内の再読込で取り直せる', () => {
  test('混雑のあと復旧すれば、同じ画面の再読込で一覧が戻る', async () => {
    fixture.listStaff = vi.fn(async () => {
      throw Object.assign(new MockApiError('rate limited'), { status: 429 })
    }) as unknown as typeof fixture.listStaff
    render(<BookingStaffPage />)

    // 待ち案内と一緒に再試行の口が出る。
    await screen.findByText('予約スタッフを表示できませんでした')
    const retry = screen.getByRole('button', { name: '予約スタッフを再読み込み' })

    fixture.listStaff = vi.fn(async () => ({ staff: [ROW] })) as unknown as typeof fixture.listStaff
    fireEvent.click(retry)
    await screen.findByText('稼働さん')
  })

  test('403は権限案内のみで、再試行の口は出さない', async () => {
    fixture.listStaff = vi.fn(async () => {
      throw Object.assign(new MockApiError('forbidden'), { status: 403 })
    }) as unknown as typeof fixture.listStaff
    render(<BookingStaffPage />)

    await screen.findByText('予約スタッフを表示できませんでした')
    expect(screen.queryByRole('button', { name: '予約スタッフを再読み込み' })).toBeNull()
  })

  test('通信断でも再試行の口は出る', async () => {
    fixture.listStaff = vi.fn(async () => { throw new Error('network') }) as unknown as typeof fixture.listStaff
    render(<BookingStaffPage />)

    await screen.findByText('予約スタッフを表示できませんでした')
    expect(screen.getByRole('button', { name: '予約スタッフを再読み込み' })).toBeTruthy()
  })
})
