// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  listMenus: vi.fn(),
  listResources: vi.fn(),
  createResource: vi.fn(),
  updateResource: vi.fn(),
  deleteResource: vi.fn(),
  getAvailability: vi.fn(),
}))

const accountSetters = new Set<(id: string | null) => void>()
function useControllableAccount() {
  const [id, setId] = React.useState(fixture.selectedAccountId)
  React.useEffect(() => {
    accountSetters.add(setId)
    return () => { accountSetters.delete(setId) }
  }, [])
  return {
    selectedAccountId: id,
    selectedAccount: id ? { id, name: id === 'account-a' ? '本店' : '支店', liffId: null } : null,
  }
}
function switchAccount(id: string | null) {
  fixture.selectedAccountId = id
  act(() => { accountSetters.forEach((setId) => setId(id)) })
}

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => useControllableAccount() }))
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
      getSettings: (...args: unknown[]) => fixture.getSettings(...args),
      saveSettings: (...args: unknown[]) => fixture.saveSettings(...args),
      listMenus: (...args: unknown[]) => fixture.listMenus(...args),
      listResources: (...args: unknown[]) => fixture.listResources(...args),
      createResource: (...args: unknown[]) => fixture.createResource(...args),
      updateResource: (...args: unknown[]) => fixture.updateResource(...args),
      deleteResource: (...args: unknown[]) => fixture.deleteResource(...args),
      getAvailability: (...args: unknown[]) => fixture.getAvailability(...args),
      createException: vi.fn(),
    },
  }
})

import { ApiError } from '@/lib/api'
import StaffShiftsPage from './page'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function settings(accountId = 'account-a', overrides: Record<string, unknown> = {}) {
  return {
    id: null,
    lineAccountId: accountId,
    organizationName: accountId === 'account-a' ? '本店' : '支店',
    version: 0,
    timeZone: 'Asia/Tokyo',
    bookingWindowDays: 60,
    cutoffMinutesBefore: 1440,
    cancelDeadlineMinutesBefore: 1440,
    maxActiveBookingsPerFriend: 1,
    approvalMode: 'automatic',
    holdMinutes: 15,
    slotGranularityMinutes: 15,
    menuCount: 0,
    activeMenuCount: 0,
    inactiveMenuCount: 0,
    businessHoursConfigured: false,
    businessHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [] })),
    exceptions: [],
    updatedAt: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

function resource(id = 'resource-a', overrides: Record<string, unknown> = {}) {
  return {
    id,
    lineAccountId: 'account-a',
    name: '個室A',
    type: 'room',
    capacity: 2,
    isActive: true,
    version: 1,
    createdAt: '2026-09-01T00:00:00+09:00',
    updatedAt: '2026-09-01T00:00:00+09:00',
    businessHours: [],
    exceptions: [],
    usage: { menuCount: 0, bookingCount: 0, exceptionCount: 0, referenced: false },
    ...overrides,
  }
}

beforeEach(() => {
  const stored = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => stored.clear(),
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  })
  window.localStorage.clear()
  window.localStorage.setItem('lh_staff_role', 'owner')
  fixture.selectedAccountId = 'account-a'
  fixture.getSettings.mockImplementation(async (accountId: string) => ({ success: true, data: settings(accountId) }))
  fixture.saveSettings.mockImplementation(async (accountId: string, body: Record<string, unknown>) => ({
    success: true,
    data: settings(accountId, {
      ...body,
      id: `settings-${accountId}`,
      version: 1,
      businessHoursConfigured: true,
    }),
  }))
  fixture.listMenus.mockResolvedValue({ menus: [{ id: 'menu-1', is_active: 1 }] })
  fixture.listResources.mockResolvedValue({ data: { resources: [] } })
  fixture.createResource.mockImplementation(async (accountId: string, body: Record<string, unknown>) => ({
    data: resource('resource-new', { lineAccountId: accountId, ...body }),
  }))
  fixture.updateResource.mockImplementation(async (_accountId: string, _id: string, body: Record<string, unknown>) => ({
    data: resource('resource-a', { ...body, version: 2 }),
  }))
  fixture.deleteResource.mockResolvedValue({ data: { id: 'resource-a' } })
  fixture.getAvailability.mockResolvedValue({ by_staff: [] })
})

afterEach(() => {
  cleanup()
  accountSetters.clear()
  vi.clearAllMocks()
})

async function renderEditor() {
  render(<StaffShiftsPage />)
  await screen.findByRole('button', { name: '営業時間を保存' })
}

describe('店舗営業時間の編集', () => {
  test('未設定の0行曜日は定休日と断定せず、保存後の意味を案内する', async () => {
    await renderEditor()
    expect(screen.getByText(/まだ週全体の営業時間を保存していません/)).toBeTruthy()
    expect(screen.getAllByText('未設定（現在は担当者の勤務時間どおり）')).toHaveLength(7)
    expect(screen.queryByText('休み（定休日）')).toBeNull()
  })

  test('7曜日をexpectedVersion付きで1回だけ保存し、設定と空き枠を読み直す', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を受け付ける' }))
    fireEvent.change(screen.getByLabelText('月曜日 1件目の開始'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('月曜日 1件目の終了'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('月曜日 1件目の同時受付数'), { target: { value: '3' } })
    const save = screen.getByRole('button', { name: '営業時間を保存' })
    fireEvent.click(save)
    fireEvent.click(save)

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledTimes(1))
    expect(fixture.saveSettings).toHaveBeenCalledWith('account-a', expect.objectContaining({
      expectedVersion: 0,
      businessHours: expect.arrayContaining([{
        weekday: 1,
        intervals: [{ start: '10:00', end: '18:00', capacity: 3 }],
      }]),
    }))
    await waitFor(() => expect(fixture.getSettings.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(fixture.getAvailability.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect((await screen.findByRole('status')).textContent).toContain('営業時間を保存しました。')
  })

  test('同じ曜日の重複区間はAPIへ送らず画面内で止める', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を受け付ける' }))
    fireEvent.click(screen.getByRole('button', { name: '時間帯を追加' }))
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存' }))
    expect((await screen.findByRole('alert')).textContent).toContain('重ならないように入力してください')
    expect(fixture.saveSettings).not.toHaveBeenCalled()
  })

  test('24:00・日またぎを黙って丸めず画面内で案内する', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を受け付ける' }))
    fireEvent.change(screen.getByLabelText('月曜日 1件目の開始'), { target: { value: '22:00' } })
    fireEvent.change(screen.getByLabelText('月曜日 1件目の終了'), { target: { value: '02:00' } })
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存' }))
    expect((await screen.findByRole('alert')).textContent).toContain('日ごとに分けて入力してください')
    expect(fixture.saveSettings).not.toHaveBeenCalled()
  })

  test('409は上書きせず最新内容の再読込を案内する', async () => {
    fixture.saveSettings.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'version_conflict'))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存' }))
    expect((await screen.findByRole('alert')).textContent).toContain('ほかの担当者が先に保存しました')
    fireEvent.click(screen.getByRole('button', { name: '最新の内容を読み直す' }))
    await waitFor(() => expect(fixture.getSettings.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  test('保存待ち中にaccountを切り替えたら旧accountの応答を親画面へ反映しない', async () => {
    let resolveSave!: (value: unknown) => void
    fixture.saveSettings.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存' }))
    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledTimes(1))

    switchAccount('account-b')
    await waitFor(() => expect(fixture.getSettings).toHaveBeenCalledWith('account-b'))
    await screen.findByRole('button', { name: '営業時間を保存' })
    await act(async () => {
      resolveSave({ success: true, data: settings('account-a', { version: 1, businessHoursConfigured: true }) })
      await Promise.resolve()
    })

    expect(fixture.getSettings.mock.calls.filter(([id]) => id === 'account-b')).toHaveLength(1)
    expect(screen.queryByText('営業時間を保存しました。')).toBeNull()
    expect(screen.getByText(/まだ週全体の営業時間を保存していません/)).toBeTruthy()
  })
})

describe('予約設備の編集', () => {
  test('保存失敗でも入力を残し、再試行でき、連打は1要求にまとめる', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    let rejectFirst!: (reason: unknown) => void
    fixture.updateResource.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
    await renderEditor()
    const name = await screen.findByLabelText('個室Aの設備名') as HTMLInputElement
    fireEvent.change(name, { target: { value: '個室B' } })
    const save = screen.getByRole('button', { name: '設備を保存' })
    act(() => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(fixture.updateResource).toHaveBeenCalledTimes(1)
    await act(async () => { rejectFirst(new Error('network')); await Promise.resolve() })
    expect((await screen.findByRole('alert')).textContent).toContain('入力内容は残っています')
    expect(name.value).toBe('個室B')

    fireEvent.click(screen.getByRole('button', { name: '設備を保存' }))
    await waitFor(() => expect(fixture.updateResource).toHaveBeenCalledTimes(2))
    expect(fixture.updateResource).toHaveBeenLastCalledWith('account-a', 'resource-a', expect.objectContaining({
      expectedVersion: 1, name: '個室B', capacity: 2,
    }))
  })

  test('停止・再開・削除はexpectedVersion付きで送り、staffは閲覧だけ', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: '受付を停止' }))
    await waitFor(() => expect(fixture.updateResource).toHaveBeenCalledWith(
      'account-a', 'resource-a', expect.objectContaining({ expectedVersion: 1, isActive: false }),
    ))

    cleanup()
    accountSetters.clear()
    window.localStorage.setItem('lh_staff_role', 'staff')
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    expect((await screen.findByLabelText('個室Aの設備名') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '設備を保存' })).toBeNull()
    expect(screen.getByText(/閲覧のみです/)).toBeTruthy()
  })

  test('account切替直後は旧設備を新accountとして描画せず、旧保存応答も捨てる', async () => {
    fixture.listResources.mockImplementation(async (accountId: string) => ({
      data: { resources: accountId === 'account-a' ? [resource()] : [] },
    }))
    let resolveSave!: (value: unknown) => void
    fixture.updateResource.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    await renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: '設備を保存' }))
    await waitFor(() => expect(fixture.updateResource).toHaveBeenCalledTimes(1))

    switchAccount('account-b')
    expect(screen.queryByLabelText('個室Aの設備名')).toBeNull()
    await screen.findByText('設備は登録されていません')
    await act(async () => {
      resolveSave({ data: resource('resource-a', { name: '旧応答', version: 2 }) })
      await Promise.resolve()
    })
    expect(screen.queryByText('旧応答')).toBeNull()
    expect(screen.getByText('設備は登録されていません')).toBeTruthy()
  })

  test('切替先の読込失敗は永久loadingにせず、エラーから再試行できる', async () => {
    fixture.listResources.mockImplementation(async (accountId: string) => {
      if (accountId === 'account-b' && fixture.listResources.mock.calls.filter(([id]) => id === 'account-b').length === 1) {
        throw new Error('temporary')
      }
      return { data: { resources: [] } }
    })
    await renderEditor()
    switchAccount('account-b')
    await screen.findByText('受付時間と休業日を表示できませんでした')
    fireEvent.click(screen.getByRole('button', { name: '受付時間と休業日を再読み込み' }))
    await waitFor(() => expect(fixture.listResources.mock.calls.filter(([id]) => id === 'account-b')).toHaveLength(2))
    await screen.findByText('設備は登録されていません')
  })

  test('設備追加の連打を1要求にし、成功した設備を一覧へ反映する', async () => {
    let resolveCreate!: (value: unknown) => void
    fixture.createResource.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve }))
    await renderEditor()
    fireEvent.change(await screen.findByLabelText('新しい設備名'), { target: { value: '新個室' } })
    fireEvent.change(screen.getByLabelText('新しい設備の種類'), { target: { value: 'room' } })
    const add = screen.getByRole('button', { name: '設備を追加' })
    act(() => {
      add.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      add.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(fixture.createResource).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCreate({ data: resource('resource-new', { name: '新個室' }) })
      await Promise.resolve()
    })
    await screen.findByLabelText('新個室の設備名')
  })
})
