// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  listStaff: vi.fn(),
  createStaff: vi.fn(),
  updateStaff: vi.fn(),
  deleteStaff: vi.fn(),
  listMenus: vi.fn(),
  putStaffMenus: vi.fn(),
  routerPush: vi.fn(),
}))

const accountSetters = new Set<(id: string | null) => void>()
function useControllableAccount(): string | null {
  const [id, setId] = React.useState(fixture.selectedAccountId)
  React.useEffect(() => {
    accountSetters.add(setId)
    return () => { accountSetters.delete(setId) }
  }, [])
  return id
}
function switchAccount(id: string | null): void {
  fixture.selectedAccountId = id
  act(() => { accountSetters.forEach((setId) => setId(id)) })
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: useControllableAccount() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/components/shared/image-uploader', () => ({
  default: ({ value, onChange, label }: {
    value: { url: string } | null
    onChange: (value: { mode: 'url'; url: string } | null) => void
    label: string
  }) => (
    <label>{label}
      <input
        aria-label={`${label}URL`}
        value={value?.url ?? ''}
        onChange={(event) => onChange({ mode: 'url', url: event.target.value })}
      />
    </label>
  ),
}))
vi.mock('@/lib/api', () => ({
  bookingApi: {
    listStaff: (...args: unknown[]) => fixture.listStaff(...args),
    createStaff: (...args: unknown[]) => fixture.createStaff(...args),
    updateStaff: (...args: unknown[]) => fixture.updateStaff(...args),
    deleteStaff: (...args: unknown[]) => fixture.deleteStaff(...args),
    listMenus: (...args: unknown[]) => fixture.listMenus(...args),
    putStaffMenus: (...args: unknown[]) => fixture.putStaffMenus(...args),
  },
}))

import BookingStaffPage from './page'
import NewBookingStaffPage from './new/page'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

async function openCreateModal() {
  render(<BookingStaffPage />)
  await screen.findByText('予約スタッフはまだいません')
  fireEvent.click(screen.getByRole('button', { name: '+ 新規スタッフ' }))
  await screen.findByText('新規スタッフ')
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/内部名/), { target: { value: '  田中 美咲  ' } })
  fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: '  みさき  ' } })
}

beforeEach(() => {
  fixture.selectedAccountId = 'account-a'
  fixture.listStaff.mockReset().mockResolvedValue({ staff: [] })
  fixture.createStaff.mockReset().mockResolvedValue({ id: 'new-staff' })
  fixture.updateStaff.mockReset().mockResolvedValue({ ok: true })
  fixture.deleteStaff.mockReset().mockResolvedValue({ ok: true })
  fixture.listMenus.mockReset().mockResolvedValue({ menus: [] })
  fixture.putStaffMenus.mockReset().mockResolvedValue({ ok: true })
  fixture.routerPush.mockReset()
})

afterEach(() => {
  cleanup()
  accountSetters.clear()
})

describe('予約スタッフ保存前検証（実React）', () => {
  test.each([
    ['空白名', async () => {
      fireEvent.change(screen.getByLabelText(/内部名/), { target: { value: '   ' } })
      fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: '表示名' } })
    }, 'スタッフ名を入力してください'],
    ['過長値', async () => {
      fillRequired()
      fireEvent.change(screen.getByLabelText('紹介文'), { target: { value: 'あ'.repeat(2_001) } })
    }, '紹介文は2000文字以内で入力してください'],
    ['不正URL', async () => {
      fillRequired()
      fireEvent.change(screen.getByLabelText('プロフィール画像URL'), { target: { value: 'javascript:alert(1)' } })
    }, 'プロフィール画像URLはhttp://またはhttps://で始まるURLを入力してください'],
    ['範囲外整数', async () => {
      fillRequired()
      fireEvent.change(screen.getByLabelText('並び順'), { target: { value: '1000001' } })
    }, '並び順は0から1000000までの整数で入力してください'],
  ])('%sは理由を表示し、APIを呼ばない', async (_label, arrange, message) => {
    await openCreateModal()
    await arrange()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(fixture.createStaff).not.toHaveBeenCalled()
  })

  test('正常値はtrimした値で保存し、一覧を再読込する', async () => {
    await openCreateModal()
    fillRequired()
    fireEvent.change(screen.getByLabelText('役職'), { target: { value: '  店長  ' } })
    fireEvent.change(screen.getByLabelText('紹介文'), { target: { value: '  小型犬が得意です。  ' } })
    fireEvent.change(screen.getByLabelText('プロフィール画像URL'), {
      target: { value: '  https://example.test/staff.png  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(fixture.createStaff).toHaveBeenCalledWith('account-a', expect.objectContaining({
      name: '田中 美咲', display_name: 'みさき', role: '店長',
      bio: '小型犬が得意です。', profile_image_url: 'https://example.test/staff.png',
    })))
    await waitFor(() => expect(fixture.listStaff).toHaveBeenCalledTimes(2))
  })

  test('account切替後に遅れて返った旧accountの一覧を表示しない', async () => {
    const oldAccount = deferred<{ staff: Array<Record<string, unknown>> }>()
    fixture.listStaff.mockImplementation((accountId: string) => accountId === 'account-a'
      ? oldAccount.promise
      : Promise.resolve({ staff: [{
        id: 'staff-b', name: 'B店内部名', display_name: 'B店担当', role: null,
        profile_image_url: null, bio: null, sort_order: 0,
        is_designation_optional: 0, is_active: 1,
      }] }))
    render(<BookingStaffPage />)
    switchAccount('account-b')
    expect(await screen.findByText('B店担当')).toBeTruthy()

    oldAccount.resolve({ staff: [{
      id: 'staff-a', name: 'A店内部名', display_name: 'A店担当', role: null,
      profile_image_url: null, bio: null, sort_order: 0,
      is_designation_optional: 0, is_active: 1,
    }] })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('A店担当')).toBeNull()
  })

  test('専用の新規登録画面も空白名を同じ理由で止める', async () => {
    render(<NewBookingStaffPage />)
    fireEvent.change(screen.getByLabelText(/スタッフ名/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'スタッフを登録' }))
    expect(await screen.findByText('スタッフ名を入力してください')).toBeTruthy()
    expect(fixture.createStaff).not.toHaveBeenCalled()
  })

  test('専用の新規登録画面もtrimした値を保存する', async () => {
    fixture.listMenus.mockResolvedValue({ menus: [{
      id: 'menu-a', name: 'カット', category_label: null, description: null,
      duration_minutes: 60, buffer_after_minutes: 0, base_price: 5_000,
      price_mode: 'fixed', sort_order: 0, is_active: 1, auto_tag_id: null,
      concurrent_capacity: 1, booking_window_days: null, cutoff_hours_before: null,
      cancel_deadline_hours_before: null, intake_question: null,
      assigned_staff: [], assigned_resources: [], version: 1,
    }] })
    render(<NewBookingStaffPage />)
    fireEvent.change(screen.getByLabelText(/スタッフ名/), { target: { value: '  田中  ' } })
    fireEvent.change(screen.getByLabelText(/お客様向けの表示名/), { target: { value: '  たなか  ' } })
    fireEvent.change(screen.getByLabelText(/肩書き/), { target: { value: '  店長  ' } })
    fireEvent.change(screen.getByLabelText(/顔写真/), { target: { value: '  https://example.test/tanaka.png  ' } })
    fireEvent.change(screen.getByLabelText(/紹介文/), { target: { value: '  丁寧に対応します。  ' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: /カット/ }))
    fireEvent.click(screen.getByRole('button', { name: 'スタッフを登録' }))

    await waitFor(() => expect(fixture.createStaff).toHaveBeenCalledWith('account-a', expect.objectContaining({
      name: '田中', display_name: 'たなか', role: '店長',
      profile_image_url: 'https://example.test/tanaka.png', bio: '丁寧に対応します。',
    })))
    await waitFor(() => expect(fixture.putStaffMenus).toHaveBeenCalledWith('account-a', 'new-staff', [{
      menu_id: 'menu-a', is_offered: true,
      override_duration_minutes: null, override_price: null,
    }]))
  })
})
