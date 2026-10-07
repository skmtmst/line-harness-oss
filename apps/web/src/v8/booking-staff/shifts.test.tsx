// @vitest-environment happy-dom
/*
 * ★V8 勤務とシフト（d5fmnM）・自分の勤務（E3YDK）・ひも付けなし（wvGke）の動き。
 * - 役割はサーバー（/api/staff/me）で決める（手元の保存値が owner でも、サーバーが staff なら本人の画面）。
 * - 休憩は同じ時刻の曜日を1行にまとめ、保存のときは曜日ごとに広げる。
 * - 変える権限が無い人には保存・足す・ごみ箱のボタンを置かない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  role: 'owner' as string,
  replace: vi.fn(),
  push: vi.fn(),
  myStaff: [] as Array<Record<string, unknown>>,
  putBreaks: vi.fn(),
}))

const stableRouter = { replace: (...args: unknown[]) => fixture.replace(...args), push: (...args: unknown[]) => fixture.push(...args) }
vi.mock('next/navigation', () => ({ useRouter: () => stableRouter, useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }) }))

const STAFF = { id: 'bs-1', name: '佐々木 亮太', display_name: '佐々木', role: 'トリマー', profile_image_url: null, bio: null, sort_order: 1, is_designation_optional: 0, is_active: 1 }

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    data?: unknown
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: { staff: { me: async () => ({ success: true, data: { id: 'me', name: 'me', role: fixture.role, email: null } }) } },
    bookingApi: {
      listMyStaff: async () => ({ staff: fixture.myStaff }),
      listStaff: async () => ({ staff: [STAFF] }),
      getSettings: async () => ({ success: true, data: { timeZone: 'Asia/Tokyo', exceptions: [], businessHoursConfigured: false, businessHours: [] } }),
      listMenus: async () => ({ menus: [] }),
      listExceptions: async () => ({ success: true, data: { items: [] } }),
      getAvailabilityRules: async () => ({ rules: [{ weekday: 1, start_time: '10:00', end_time: '19:00' }] }),
      getShifts: async () => ({ shifts: [] }),
      getBreaks: async () => ({
        version: 'v1',
        breaks: [1, 2, 3, 4, 5].map((weekday) => ({ id: `bb-${weekday}`, weekday, start_time: '13:00', end_time: '14:00' })),
      }),
      getBreakDates: async () => ({ version: 'd1', breaks: [] }),
      getGoogleCalendar: async () => ({ connection: null, service_account: { configured: true } }),
      putBreaks: (...args: unknown[]) => fixture.putBreaks(...args),
    },
  }
})

import StaffShiftsV8, { groupBreaks, shortDay, weekdaySetLabel } from './shifts'

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
  memStorage.setItem('lh_staff_role', 'owner')
  fixture.role = 'owner'
  fixture.myStaff = []
  fixture.replace.mockClear()
  fixture.putBreaks.mockReset()
  fixture.putBreaks.mockImplementation(async (_a: unknown, _s: unknown, _v: unknown, rows: Array<{ weekday: number; start_time: string; end_time: string }>) => ({
    version: 'v2',
    breaks: rows.map((row, i) => ({ id: `n-${i}`, ...row })),
  }))
})

afterEach(() => {
  cleanup()
  memStorage.clear()
})

describe('休憩の曜日のまとまり', () => {
  test('続いた3日以上は「〜」、それ以外は「・」でつなぐ', () => {
    expect(weekdaySetLabel([1, 2, 3, 4, 5])).toBe('月〜金')
    expect(weekdaySetLabel([6, 0])).toBe('土・日')
    expect(weekdaySetLabel([1, 3])).toBe('月・水')
    expect(weekdaySetLabel([0, 1, 2, 3, 4, 5, 6])).toBe('毎日')
    expect(weekdaySetLabel([2])).toBe('火')
  })

  test('同じ時刻の曜日は1行に、違う時刻は別の行になる', () => {
    const groups = groupBreaks([
      { id: 'a', weekday: 1, start_time: '13:00', end_time: '14:00' },
      { id: 'b', weekday: 2, start_time: '13:00', end_time: '14:00' },
      { id: 'c', weekday: 2, start_time: '16:00', end_time: '16:30' },
    ])
    expect(groups.map((g) => [g.weekdays, g.start])).toEqual([[[1, 2], '13:00'], [[2], '16:00']])
    expect(groups[0].ids).toEqual({ 1: 'a', 2: 'b' })
  })

  test('日付は「10/12（月）」の形', () => {
    expect(shortDay('2026-10-12')).toBe('10/12（月）')
  })
})

describe('役割はサーバーで決める', () => {
  test('手元が owner でもサーバーが staff なら、ひも付けなしの案内を出す（受付枠へ送らない）', async () => {
    fixture.role = 'staff'
    render(<StaffShiftsV8 staffId="" />)
    expect(await screen.findByText('ひも付いた予約スタッフがありません')).toBeTruthy()
    expect(screen.getByRole('link', { name: '予約の一覧へ戻る' })).toBeTruthy()
    expect(fixture.replace).not.toHaveBeenCalled()
  })

  test('本人の予約スタッフがあれば自分の勤務へ移る', async () => {
    fixture.role = 'staff'
    fixture.myStaff = [STAFF]
    render(<StaffShiftsV8 staffId="" />)
    await waitFor(() => { expect(fixture.replace).toHaveBeenCalledWith('/booking/staff/shifts?staff_id=bs-1') })
  })

  test('管理者が staff_id なしで来たら受付枠へ送る', async () => {
    render(<StaffShiftsV8 staffId="" />)
    await waitFor(() => { expect(fixture.replace).toHaveBeenCalledWith('/booking/menus?tab=hours') })
  })

  test('本人の画面は題が「自分の勤務」で、戻るリンクを出さない', async () => {
    fixture.role = 'staff'
    fixture.myStaff = [STAFF]
    render(<StaffShiftsV8 staffId="bs-1" />)
    expect(await screen.findByText('佐々木 亮太（トリマー）としてひも付いています。ひも付けを変えるときは管理者に頼んでください。')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '自分の勤務' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '← 担当スタッフへ' })).toBeNull()
  })
})

describe('勤務とシフト（管理者）', () => {
  test('休憩は月〜金の1行で出し、保存のときは曜日ごとに広げて今のIDを付けて送る', async () => {
    render(<StaffShiftsV8 staffId="bs-1" />)
    expect(await screen.findByRole('button', { name: '休憩の曜日（月〜金）を選ぶ' })).toBeTruthy()
    const saveButtons = screen.getAllByRole('button', { name: '保存' })
    fireEvent.click(saveButtons[1])
    await waitFor(() => { expect(fixture.putBreaks).toHaveBeenCalled() })
    const rows = fixture.putBreaks.mock.calls[0][3] as Array<{ id?: string; weekday: number }>
    expect(rows.map((r) => [r.weekday, r.id])).toEqual([[1, 'bb-1'], [2, 'bb-2'], [3, 'bb-3'], [4, 'bb-4'], [5, 'bb-5']])
  })

  test('曜日を外すと、その曜日は送らない', async () => {
    render(<StaffShiftsV8 staffId="bs-1" />)
    fireEvent.click(await screen.findByRole('button', { name: '休憩の曜日（月〜金）を選ぶ' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '水' }))
    expect(screen.getByRole('button', { name: '休憩の曜日（月・火・木・金）を選ぶ' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[1])
    await waitFor(() => { expect(fixture.putBreaks).toHaveBeenCalled() })
    const rows = fixture.putBreaks.mock.calls[0][3] as Array<{ weekday: number }>
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 4, 5])
  })

  test('変える権限が無い人には、保存・足す・ごみ箱のボタンを置かない', async () => {
    memStorage.setItem('lh_staff_role', 'staff')
    memStorage.setItem('lh_staff_permissions', '[]')
    fixture.role = 'staff'
    fixture.myStaff = [STAFF]
    render(<StaffShiftsV8 staffId="bs-1" />)
    expect(await screen.findByText(/閲覧のみです/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    expect(screen.queryByRole('button', { name: /休憩を足す/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /この日を足す/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /の休憩を削除/ })).toBeNull()
  })
})
