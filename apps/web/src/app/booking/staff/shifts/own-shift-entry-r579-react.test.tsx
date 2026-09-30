// @vitest-environment happy-dom
/*
 * R579: 本人勤務の担当者取得の失敗と「紐づけ無し」を言い分ける。
 *
 * - 2経路（選択中アカウント・全体）とも失敗したら「紐づく予約スタッフが
 *   ありません」と断定せず、同画面での再試行の口を出す。
 * - 本当の0件は今までどおり紐づけ待ちの案内だけで、再試行は出さない。
 * - 再試行で直れば本人勤務（?staff_id=）へ進む。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listMyStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
  replace: vi.fn(),
}))

// 本物の next/navigation の useRouter は描画ごとに同じ参照を返す。
// 試験でも同じにして、参照の変わり目での余計な再取得を起こさない。
const stableRouter = { replace: (...args: unknown[]) => fixture.replace(...args), push: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))

vi.mock('./staff-detail', () => ({ default: () => <div>担当者別</div> }))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    code?: string
    constructor(status: number, message?: string, code?: string) {
      super(message ?? `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
    }
  }
  return {
    ApiError,
    bookingApi: {
      listMyStaff: (...args: unknown[]) => fixture.listMyStaff!(...(args as [])),
    },
  }
})

import StaffShiftsPage from './page'

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

beforeEach(() => {
  // staff ロールで店舗の閲覧権限なし。本人解決だけが頼りになる条件。
  memStorage.setItem('lh_staff_role', 'staff')
  fixture.listMyStaff = async () => ({ staff: [] })
  fixture.replace.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  memStorage.clear()
})

describe('R579 本人勤務の取得失敗と紐づけ無しを言い分ける', () => {
  test('2経路とも失敗したら紐づけ無しと断定せず再試行を出す', async () => {
    fixture.listMyStaff = async () => { throw new Error('service unavailable') }
    render(<StaffShiftsPage />)

    expect(await screen.findByText('自分の勤務を読み込めませんでした')).toBeTruthy()
    expect(screen.queryByText('紐づく予約スタッフがありません')).toBeNull()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
    expect(fixture.replace).not.toHaveBeenCalled()
  })

  test('本当の0件は紐づけ待ちの案内だけで再試行は出さない', async () => {
    fixture.listMyStaff = async () => ({ staff: [] })
    render(<StaffShiftsPage />)

    expect(await screen.findByText('紐づく予約スタッフがありません')).toBeTruthy()
    expect(screen.queryByText('自分の勤務を読み込めませんでした')).toBeNull()
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
  })

  test('再試行で直れば同画面から本人勤務へ進む', async () => {
    let fail = true
    fixture.listMyStaff = async () => {
      if (fail) throw new Error('service unavailable')
      return { staff: [{ id: 'staff-1' }] }
    }
    render(<StaffShiftsPage />)
    await screen.findByText('自分の勤務を読み込めませんでした')

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))

    await waitFor(() => {
      expect(fixture.replace).toHaveBeenCalledWith('/booking/staff/shifts?staff_id=staff-1')
    })
  })
})
