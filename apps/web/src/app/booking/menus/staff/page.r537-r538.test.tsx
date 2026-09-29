// @vitest-environment happy-dom
/*
 * R537 / R538: 担当割当表の取得失敗と権限の出し分けを実物の React で描いて確かめる。
 *
 * - R537: 各GETの通信断から復旧後に画面内で再取得でき、失敗中に
 *   未登録扱いの空状態（「先にスタッフを登録してください」）を出さない。
 *   403は権限案内のみで再試行の口を出さない。429は再試行できる。
 * - R538: 閲覧のみの担当者は割当を読めても、チェック・数値・保存の入口に
 *   進めない。編集権限を持つ担当者だけが変えられる。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  canEditKeys: ['/booking/menus', 'booking.settings'] as string[],
  listMenus: null as null | (() => Promise<unknown>),
  listStaff: null as null | (() => Promise<unknown>),
  listStaffMenusBulk: null as null | (() => Promise<unknown>),
  putStaffMenusBulk: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
}))

vi.mock('@/lib/staff-capability', () => ({
  canEditFeature: (key: string) => fixture.canEditKeys.includes(key),
  canViewFeature: () => true,
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status?: number
  },
  describeSaveFailure: () => '保存に失敗しました。',
  bookingApi: {
    listMenus: (...args: unknown[]) => fixture.listMenus!(...(args as [])),
    listStaff: (...args: unknown[]) => fixture.listStaff!(...(args as [])),
    listStaffMenusBulk: (...args: unknown[]) => fixture.listStaffMenusBulk!(...(args as [])),
    putStaffMenusBulk: (...args: unknown[]) => fixture.putStaffMenusBulk!(...args),
  },
}))

import { ApiError as MockApiError } from '@/lib/api'
import MenuStaffMatrix from './page'

const MENUS = [
  { id: 'menu-cut', name: 'カット', duration_minutes: 60, base_price: 8000, price_mode: 'fixed', is_active: 1 },
]

const STAFF = [
  { id: 'staff-a', name: '稼働', display_name: '稼働さん', is_active: 1, is_designation_optional: 0 },
]

function succeedAll() {
  fixture.listMenus = async () => ({ menus: MENUS })
  fixture.listStaff = async () => ({ staff: STAFF })
  fixture.listStaffMenusBulk = async () => ({
    staff: [{
      staff_id: 'staff-a',
      matrix: MENUS.map((m) => ({
        menu_id: m.id,
        name: m.name,
        // R538 の数値欄も描くため割当済みにする。
        is_offered: 1,
        override_duration_minutes: null,
        override_price: null,
      })),
    }],
  })
  fixture.putStaffMenusBulk = vi.fn(async () => ({ ok: true }))
}

beforeEach(() => {
  fixture.canEditKeys = ['/booking/menus', 'booking.settings']
  succeedAll()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('R537 取得失敗は空状態と分け、画面内で取り直せる', () => {
  test('通信断では未登録扱いにせず、復旧後に同じ画面から再取得できる', async () => {
    fixture.listMenus = async () => { throw new Error('network') }
    render(<MenuStaffMatrix />)

    await screen.findByText('表示できませんでした')
    // 失敗中に「先にスタッフを登録してください」は出さない。
    expect(screen.queryByText('先にスタッフを登録してください')).toBeNull()
    // KPI も0ではなく「—」。
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)

    // 通信復旧後に同じ画面から取り直す。
    succeedAll()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await screen.findAllByText('カット')
    expect(screen.queryByText('表示できませんでした')).toBeNull()
  })

  test('403は権限案内のみで、再試行の口は出さない', async () => {
    fixture.listMenus = async () => {
      throw Object.assign(new MockApiError('forbidden'), { status: 403 })
    }
    render(<MenuStaffMatrix />)

    await screen.findByText('担当スタッフの割り当てを見る権限がありません')
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
    expect(screen.queryByText('先にスタッフを登録してください')).toBeNull()
  })

  test('429は待ち案内と一緒に再試行の口を出す', async () => {
    fixture.listMenus = async () => {
      throw Object.assign(new MockApiError('rate limited'), { status: 429 })
    }
    render(<MenuStaffMatrix />)

    await screen.findByText('混み合っています')
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
    expect(screen.queryByText('先にスタッフを登録してください')).toBeNull()
  })
})

describe('R538 閲覧のみでは変更・保存の入口に進めない', () => {
  test('閲覧のみは読めてもチェックと保存は押せない', async () => {
    fixture.canEditKeys = []
    render(<MenuStaffMatrix />)
    await screen.findAllByText('カット')

    // 表は読める。
    expect(screen.getByText('稼働さん')).toBeTruthy()
    // チェックは押せない。
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) expect((box as HTMLInputElement).disabled).toBe(true)
    // 数値の上書きも押せない。
    const duration = screen.getByLabelText('稼働さん の カット の所要時間') as HTMLInputElement
    expect(duration.disabled).toBe(true)
    // 保存の押し口は出ず、理由が読める。
    expect(screen.queryByRole('button', { name: '変更を保存' })).toBeNull()
    expect(screen.getByText(/担当割当の変更権限がありません/)).toBeTruthy()
    // スタッフ追加の行き先も押せない姿になる。
    expect(screen.queryByRole('link', { name: 'スタッフを追加' })).toBeNull()
    expect(screen.getByText('スタッフを追加')).toBeTruthy()
  })

  test('編集権限があれば変えられる', async () => {
    render(<MenuStaffMatrix />)
    await screen.findAllByText('カット')

    const boxes = screen.getAllByRole('checkbox')
    for (const box of boxes) expect((box as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole('link', { name: 'スタッフを追加' })).toBeTruthy()
    expect(screen.queryByText(/担当割当の変更権限がありません/)).toBeNull()

    // 変えると保存の押し口が出る。
    fireEvent.click(boxes[0])
    expect(screen.getByRole('button', { name: '変更を保存' })).toBeTruthy()
  })
})
