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

beforeEach(() => {
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
