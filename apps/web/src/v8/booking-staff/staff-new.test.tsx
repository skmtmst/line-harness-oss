// @vitest-environment happy-dom
/*
 * ★V8 予約スタッフを登録（CcA4k）の動き。
 * - メニューのチェックは4つまで並べ、残りは「ほかのメニュー（n）」で開く（絵は1行に4つ）。
 * - 右の見本の「指名なし」は、指名なしの枠に入る担当が1人でもいれば出る。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ staff: [] as Array<Record<string, unknown>> }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

const MENUS = ['カット', 'シャンプー', '爪切り', '歯みがき', '足裏ケア', '毛刈り'].map((name, i) => ({
  id: `m-${i}`, name, duration_minutes: 30, base_price: 1000, price_mode: 'fixed', is_active: 1, sort_order: i,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { staff: { list: async () => ({ success: true, data: [] }) } },
    bookingApi: {
      listMenus: async () => ({ menus: MENUS }),
      listStaff: async () => ({ staff: fixture.staff }),
      createStaff: vi.fn(),
      putStaffMenus: vi.fn(),
    },
  }
})

import StaffNewV8 from './staff-new'

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
  fixture.staff = [
    { id: 'bs-1', name: '佐々木 亮太', display_name: '佐々木', role: 'トリマー', sort_order: 1, is_designation_optional: 0, is_active: 1 },
  ]
})
afterEach(() => {
  cleanup()
  memStorage.clear()
})

describe('予約スタッフを登録（V8）', () => {
  test('メニューは4つまで並べ、残りは「ほかのメニュー」で開く', async () => {
    render(<StaffNewV8 />)
    await screen.findByRole('checkbox', { name: 'カット' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.queryByRole('checkbox', { name: '足裏ケア' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ほかのメニュー（2）' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(6)
    expect(screen.getByRole('checkbox', { name: '足裏ケア' })).toBeTruthy()
  })

  test('指名なしの枠に入る担当がいなければ、見本に「指名なし」を出さない。スイッチを入れると出る', async () => {
    render(<StaffNewV8 />)
    const phone = await screen.findByRole('img', { name: 'お客さまの予約画面の見本' })
    await screen.findByRole('checkbox', { name: 'カット' })
    expect(within(phone).queryByText('指名なし')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: '「指名なし」の枠にも含める' }))
    expect(within(phone).getByText('指名なし')).toBeTruthy()
  })

  test('登録済みの担当に指名なしの人がいれば、最初から「指名なし」を出す', async () => {
    fixture.staff = [...fixture.staff, { id: 'bs-2', name: '中川 由美', display_name: '中川', role: '受付', sort_order: 2, is_designation_optional: 1, is_active: 1 }]
    render(<StaffNewV8 />)
    const phone = await screen.findByRole('img', { name: 'お客さまの予約画面の見本' })
    expect(await within(phone).findByText('指名なし')).toBeTruthy()
  })
})
