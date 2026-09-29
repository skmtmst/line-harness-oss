// @vitest-environment happy-dom
/*
 * R308/R309: 担当割当表を実物の React で描いて確かめる。
 *
 * - R308: 「提供できる数」は稼働中の担当だけ。非公開の担当は割当として
 *   数え、列見出しに「非公開」と出す。受付できる担当がいないメニューは
 *   警告する（誰も割っていない場合と、非公開しかいない場合を分ける）。
 * - R309: 標準の料金は一覧と同じ言葉（お問い合わせ・無料・¥）で出す。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
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

vi.mock('@/lib/api', () => ({
  bookingApi: {
    listMenus: (...args: unknown[]) => fixture.listMenus!(...(args as [])),
    listStaff: (...args: unknown[]) => fixture.listStaff!(...(args as [])),
    listStaffMenusBulk: (...args: unknown[]) => fixture.listStaffMenusBulk!(...(args as [])),
    putStaffMenusBulk: (...args: unknown[]) => fixture.putStaffMenusBulk!(...args),
  },
}))

import MenuStaffMatrix from './page'

const MENUS = [
  { id: 'menu-cut', name: 'カット', duration_minutes: 60, base_price: 8000, price_mode: 'fixed', is_active: 1 },
  { id: 'menu-inquiry', name: '相談', duration_minutes: 30, base_price: 0, price_mode: 'inquiry', is_active: 1 },
  { id: 'menu-free', name: 'お試し', duration_minutes: 15, base_price: 0, price_mode: 'free', is_active: 1 },
  { id: 'menu-hidden-only', name: '特別ケア', duration_minutes: 90, base_price: 5000, price_mode: 'fixed', is_active: 1 },
]

const STAFF = [
  { id: 'staff-a', name: '稼働', display_name: '稼働さん', is_active: 1, is_designation_optional: 0 },
  { id: 'staff-h', name: '非公開', display_name: '非公開さん', is_active: 0, is_designation_optional: 0 },
]

function matrixRow(staffId: string, offeredMenuIds: string[]) {
  return {
    staff_id: staffId,
    matrix: MENUS.map((m) => ({
      menu_id: m.id,
      name: m.name,
      is_offered: offeredMenuIds.includes(m.id) ? 1 : 0,
      override_duration_minutes: null,
      override_price: null,
    })),
  }
}

beforeEach(() => {
  fixture.listMenus = async () => ({ menus: MENUS })
  fixture.listStaff = async () => ({ staff: STAFF })
  fixture.listStaffMenusBulk = async () => ({
    staff: [
      matrixRow('staff-a', ['menu-cut', 'menu-inquiry']),
      matrixRow('staff-h', ['menu-cut', 'menu-hidden-only']),
    ],
  })
  fixture.putStaffMenusBulk = vi.fn(async () => ({ ok: true }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** メニュー名の行。 */
function menuRow(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement
}

describe('R308 提供できる数は稼働中の担当だけ', () => {
  test('非公開の担当は割当として数え、見出しに「非公開」と出す', async () => {
    render(<MenuStaffMatrix />)
    await screen.findByText('カット')

    // 列見出しで非公開と分かる。
    const header = screen.getByText('非公開さん').closest('th') as HTMLElement
    expect(within(header).getByText('非公開')).toBeTruthy()
    // 稼働中の見出しには付けない。
    const activeHeader = screen.getByText('稼働さん').closest('th') as HTMLElement
    expect(within(activeHeader).queryByText('非公開')).toBeNull()

    // カットは稼働1＋非公開1の割当。受付できる数は1人と区別する。
    const cut = menuRow('カット')
    expect(cut.textContent).toContain('1 人')
    expect(cut.textContent).toContain('割当2（非公開1）')
  })

  test('非公開だけの割当は受付可能0人と警告する', async () => {
    render(<MenuStaffMatrix />)
    await screen.findByText('カット')

    // 特別ケアは非公開しかいない。受付できる数は0人、割当は残す。
    const row = menuRow('特別ケア')
    expect(row.textContent).toContain('0 人')
    expect(row.textContent).toContain('割当1（非公開1）')
    expect(screen.getByText('「特別ケア」は非公開の担当しかいません。')).toBeTruthy()
    // 誰も割っていない「お試し」とは別の文言。
    expect(screen.getByText('「お試し」は担当できるスタッフがいません。')).toBeTruthy()
  })

  test('稼働中を外す（未保存）と受付できる数が減り、警告が出る', async () => {
    render(<MenuStaffMatrix />)
    await screen.findByText('カット')

    // 相談は稼働中だけの割当。外すと受付できる数が0人になる。
    const row = menuRow('相談')
    const [activeBox] = within(row).getAllByRole('checkbox', { name: '対応できる' })
    fireEvent.click(activeBox)

    expect(row.textContent).toContain('0 人')
    // お試しと並んで「担当できるスタッフがいません」に入る。
    const warn = await screen.findByText('このままでは予約フォームに枠が出ません。')
    const box = warn.closest('div[data-design="Warn"]') as HTMLElement
    expect(box.textContent).toContain('「相談」')
    expect(box.textContent).toContain('担当できるスタッフがいません')
  })
})

describe('R309 標準の料金は一覧と同じ言葉', () => {
  test('お問い合わせ・無料・固定料金を区別し、¥0と出さない', async () => {
    render(<MenuStaffMatrix />)
    await screen.findByText('カット')

    expect(menuRow('カット').textContent).toContain('¥8,000')
    expect(menuRow('相談').textContent).toContain('お問い合わせ')
    expect(menuRow('お試し').textContent).toContain('無料')
    // 標準の設定に金額0の表示は残らない。
    expect(screen.queryByText('¥0')).toBeNull()
  })
})
