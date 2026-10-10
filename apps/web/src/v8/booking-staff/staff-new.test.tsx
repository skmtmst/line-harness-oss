
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import StaffNewV8 from './staff-new'
import { pickEntities } from '@/components/shared/entity-picker-test-helpers'
// @vitest-environment happy-dom
/*
 * ★V8 予約スタッフを登録（CcA4k）の動き。
 * - メニューのチェックは4つまで並べ、残りは「ほかのメニュー（n）」で開く（絵は1行に4つ）。
 * - 右の見本の「指名なし」は、指名なしの枠に入る担当が1人でもいれば出る。
 */

const fixture = vi.hoisted(() => ({ staff: [] as Array<Record<string, unknown>>, create: vi.fn(), assign: vi.fn(), update: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

const MENUS = ['カット', 'シャンプー', '爪切り', '歯みがき', '足裏ケア', '毛刈り'].map((name, i) => ({
  id: `m-${i}`, name, duration_minutes: 30, base_price: 1000, price_mode: 'fixed', is_active: 1, sort_order: i,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { staff: { me: async () => ({ success: true, data: { role: 'owner' } }), list: async () => ({ success: true, data: [] }) } },
    bookingApi: {
      listMenus: async () => ({ menus: MENUS }),
      listStaff: async () => ({ staff: fixture.staff }),
      createStaff: (...args: unknown[]) => fixture.create(...args),
      updateStaff: (...args: unknown[]) => fixture.update(...args),
      putStaffMenus: (...args: unknown[]) => fixture.assign(...args),
    },
  }
})

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
  fixture.create.mockReset().mockResolvedValue({ id: 'created' })
  fixture.update.mockReset().mockResolvedValue({ ok: true })
  fixture.assign.mockReset()
  fixture.staff = [
    { id: 'bs-1', name: '佐々木 亮太', display_name: '佐々木', role: 'トリマー', sort_order: 1, is_designation_optional: 0, is_active: 1 },
  ]
})
afterEach(() => {
  cleanup()
  memStorage.clear()
})

describe('予約スタッフを登録（V8）', () => {
  test('予約メニューは窓の中で全件から探して選べる', async () => {
    render(<StaffNewV8 />)
    await screen.findByRole('checkbox', { name: 'カット' })
    expect(screen.getAllByRole('checkbox').filter(item => item.closest('[data-setting-checkbox]') === null)).click(awaitscreen.findByRole('button', { name: '予約を受けられるメニュー' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('checkbox').filter(item => item.closest('[data-setting-checkbox]') === null)).toHaveLength(6)
    expect(within(dialog).getByRole('checkbox', { name: '足裏ケア' })).toBeTruthy()
  })

  test('指名なしの枠に入る担当がいなければ、見本に「指名なし」を出さない。スイッチを入れると出る', async () => {
    render(<StaffNewV8 />)
    const phone = await screen.findByRole('region', { name: 'お客さまの予約画面の見本' })
    await screen.findByRole('button', { name: '予約を受けられるメニュー' })
    expect(within(phone).queryByText('指名なし')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '「指名なし」の枠にも含める' }))
    expect(within(phone).getByText('指名なし')).toBeTruthy()
  })

  test('登録済みの担当に指名なしの人がいれば、最初から「指名なし」を出す', async () => {
    fixture.staff = [...fixture.staff, { id: 'bs-2', name: '中川 由美', display_name: '中川', role: '受付', sort_order: 2, is_designation_optional: 1, is_active: 1 }]
    render(<StaffNewV8 />)
    const phone = await screen.findByRole('region', { name: 'お客さまの予約画面の見本' })
    expect(await within(phone).findByText('指名なし')).toBeTruthy()
  })
})

 test('WEB186：割当の再試行前に直した名前も登録済みスタッフに保存する', async () => {
    fixture.assign.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true })
    render(<StaffNewV8 />)
    await screen.findByRole('button', { name: '予約を受けられるメニュー' })
    fireEvent.change(screen.getByLabelText('スタッフ名（管理画面での呼び名）'), { target: { value: '田中' } })
    await pickEntities('予約を受けられるメニュー', [ 'カット'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'スタッフを登録する' })) })
    await screen.findByRole('button', { name: '割当をやり直す' })
    fireEvent.change(screen.getByLabelText('スタッフ名（管理画面での呼び名）'), { target: { value: '田中 美咲' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '割当をやり直す' })) })
    await waitFor(() => expect(fixture.assign).toHaveBeenCalledTimes(2))
    expect(fixture.create).toHaveBeenCalledTimes(1)
    expect(fixture.update).toHaveBeenCalledWith('account-a', 'created', expect.objectContaining({ name: '田中 美咲' }))
 })
