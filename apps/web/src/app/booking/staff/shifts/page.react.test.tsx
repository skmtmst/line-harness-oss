// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
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
  updateException: vi.fn(),
  deleteException: vi.fn(),
  listStaff: vi.fn(),
  checkAvailability: vi.fn(),
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

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => useControllableAccount() }))
vi.mock('./staff-detail', () => ({ default: () => <div>担当者別</div> }))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の勤務時間の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))
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
      updateException: (...args: unknown[]) => fixture.updateException(...args),
      deleteException: (...args: unknown[]) => fixture.deleteException(...args),
      // N-411: staff ロールの入口は本人の予約スタッフ解決。未紐づけを既定にする。
      listMyStaff: vi.fn(async () => ({ staff: [] })),
      // IDEA-28: 確認カードの担当候補と「なぜ取れないか」のAPI。
      listStaff: (...args: unknown[]) => fixture.listStaff(...args),
      checkAvailability: (...args: unknown[]) => fixture.checkAvailability(...args),
    },
  }
})

import { ApiError } from '@/lib/api'

const WEEK = '日月火水木金土'
function partsOf(date: Date) {
  return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate() }
}
function isoOf(date: Date) {
  const { y, mo, d } = partsOf(date)
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function monthLabelOf(date: Date) {
  const { y, mo } = partsOf(date)
  return `${y}年${mo}月`
}
function dayLabelOf(date: Date) {
  const { y, mo, d } = partsOf(date)
  return `${y}年${mo}月${d}日（${WEEK[date.getDay()]}）`
}
function daysAhead(n: number) {
  const t = new Date()
  t.setDate(t.getDate() + n)
  return t
}

/** 日付の選択（★V7）で選ぶ。値は今までどおり YYYY-MM-DD。 */
async function pickDateByLabel(label: string, date: Date) {
  fireEvent.click(screen.getByLabelText(label))
  const target = partsOf(date).y * 12 + partsOf(date).mo
  for (let i = 0; i < 24; i += 1) {
    const grid = document.querySelector('[role="grid"]')
    const currentLabel = /^(\d+)年(\d+)月$/.exec(grid?.getAttribute('aria-label') ?? '')
    const current = currentLabel ? Number(currentLabel[1]) * 12 + Number(currentLabel[2]) : target
    if (grid?.getAttribute('aria-label') === monthLabelOf(date)) break
    const nav = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === (target >= current ? '次の月' : '前の月'),
    )!
    fireEvent.click(nav)
  }
  const day = [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(dayLabelOf(date)),
  )!
  fireEvent.click(day)
}

/** 時刻の選択（★V7）で HH:mm を選ぶ。値は今までどおり HH:mm。 */
async function pickTimeByLabel(label: string, hhmm: string) {
  fireEvent.click(screen.getByLabelText(label))
  const picker = document.querySelector('[role="dialog"][aria-label="時刻を選ぶ"]')!
  const [hour, minute] = hhmm.split(':')
  fireEvent.change(picker.querySelector('select[aria-label="時"]')!, { target: { value: hour } })
  fireEvent.change(picker.querySelector('select[aria-label="分"]')!, { target: { value: minute } })
  fireEvent.click([...picker.querySelectorAll('button')].find((b) => b.textContent?.trim() === '閉じる')!)
}
import StaffShiftsPage from './page'
import { slotReasonLabel } from './slot-reason'

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
  clearToastsForTest()
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
  fixture.listMenus.mockResolvedValue({ menus: [{ id: 'menu-1', name: 'カット', is_active: 1 }] })
  fixture.listResources.mockResolvedValue({ data: { resources: [] } })
  fixture.createResource.mockImplementation(async (accountId: string, body: Record<string, unknown>) => ({
    data: resource('resource-new', { lineAccountId: accountId, ...body }),
  }))
  fixture.updateResource.mockImplementation(async (_accountId: string, _id: string, body: Record<string, unknown>) => ({
    data: resource('resource-a', { ...body, version: 2 }),
  }))
  fixture.deleteResource.mockResolvedValue({ data: { id: 'resource-a' } })
  fixture.getAvailability.mockResolvedValue({ by_staff: [] })
  fixture.updateException.mockImplementation(async (_accountId: string, _id: string, body: Record<string, unknown>) => ({
    success: true,
    data: exception({ ...body, version: (body.expectedVersion as number) + 1 }),
  }))
  fixture.deleteException.mockResolvedValue({ success: true, data: { id: 'exception-a' } })
  fixture.listStaff.mockResolvedValue({
    staff: [{ id: 's1', display_name: '担当A', is_active: 1 }],
  })
  fixture.checkAvailability.mockResolvedValue({
    date: '2099-01-10',
    time: '11:00',
    timeZone: 'Asia/Tokyo',
    bookable: true,
    reasons: [],
    per_staff: [
      { staff_id: 's1', display_name: '担当A', bookable: true, remaining: 1, capacity: 1, reasons: [] },
    ],
  })
})

function exception(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exception-a',
    lineAccountId: 'account-a',
    scopeKind: 'store',
    scopeId: null,
    date: null,
    dateFrom: '2026-12-30',
    dateTo: '2026-12-30',
    kind: 'closed',
    intervals: [],
    reason: '年末休業',
    note: null,
    version: 2,
    createdAt: '2026-09-01T00:00:00+09:00',
    updatedAt: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  accountSetters.clear()
  vi.clearAllMocks()
})

async function renderEditor(viewOnly = false) {
  const availabilityCallsBeforeRender = fixture.getAvailability.mock.calls.length
  render(<><StaffShiftsPage /><ToastHost /></>)
  // N-411: 閲覧のみの人には保存ボタンを出さない。代わりに閲覧注記を待つ。
  await (viewOnly
    ? screen.findByText('閲覧のみです。変更には予約設定の権限が必要です。')
    : screen.findByRole('button', { name: '営業時間を保存する' }))
  await waitFor(() => expect(fixture.getAvailability.mock.calls.length).toBeGreaterThan(availabilityCallsBeforeRender))
  await act(async () => { await Promise.resolve() })
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
    await screen.findByLabelText('月曜日 1件目の開始')
    await pickTimeByLabel('月曜日 1件目の開始', '10:00')
    await pickTimeByLabel('月曜日 1件目の終了', '18:00')
    fireEvent.change(screen.getByLabelText('月曜日 1件目の同時受付数'), { target: { value: '3' } })
    const save = screen.getByRole('button', { name: '営業時間を保存する' })
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
    fireEvent.click(screen.getByRole('button', { name: '時間帯を追加する' }))
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('重ならないように入力してください')
    expect(fixture.saveSettings).not.toHaveBeenCalled()
  })

  test('24:00・日またぎを黙って丸めず画面内で案内する', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を受け付ける' }))
    await screen.findByLabelText('月曜日 1件目の開始')
    await pickTimeByLabel('月曜日 1件目の開始', '22:00')
    await pickTimeByLabel('月曜日 1件目の終了', '02:00')
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('日ごとに分けて入力してください')
    expect(fixture.saveSettings).not.toHaveBeenCalled()
  })

  test('409は上書きせず最新内容の再読込を案内する', async () => {
    fixture.saveSettings.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'version_conflict'))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('ほかの担当者が先に保存しました')
    fireEvent.click(screen.getByRole('button', { name: '最新の内容を読み直す' }))
    await waitFor(() => expect(fixture.getSettings.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  test('R161: 曜日を変えたまま別画面へ移ると確認を出し、編集継続で入力が残る', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を受け付ける' }))
    await screen.findByLabelText('月曜日 1件目の開始')
    fireEvent.click(screen.getByRole('link', { name: /予約管理/ }))
    await screen.findByText('保存していない変更があります')
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getByRole('checkbox', { name: '月曜日を受け付ける' }) as HTMLInputElement).checked).toBe(true)
  })

  test('R161: 変えていなければ離脱確認を出さない', async () => {
    await renderEditor()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  test('保存待ち中にaccountを切り替えたら旧accountの応答を親画面へ反映しない', async () => {
    let resolveSave!: (value: unknown) => void
    fixture.saveSettings.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '営業時間を保存する' }))
    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledTimes(1))

    switchAccount('account-b')
    await waitFor(() => expect(fixture.getSettings).toHaveBeenCalledWith('account-b'))
    await screen.findByRole('button', { name: '営業時間を保存する' })
    await act(async () => {
      resolveSave({ success: true, data: settings('account-a', { version: 1, businessHoursConfigured: true }) })
      await Promise.resolve()
    })

    expect(fixture.getSettings.mock.calls.filter(([id]) => id === 'account-b')).toHaveLength(1)
    expect(screen.queryByText('営業時間を保存しました。')).toBeNull()
    expect(screen.getByText(/まだ週全体の営業時間を保存していません/)).toBeTruthy()
  })
})

describe('R314/(b) 刻みの理由文と見本の判定', () => {
  test('R314: 刻みの理由は判定の幅を添え、無いときは幅を書かない', () => {
    expect(slotReasonLabel('not_on_grid', 15)).toBe('開始時刻が受付の刻み（15分）に合っていません')
    expect(slotReasonLabel('not_on_grid')).toBe('開始時刻が受付の刻みに合っていません')
    expect(slotReasonLabel('past_cutoff', 15)).toBe('受付の締め切り（何時間前まで取れるか）を過ぎています')
  })

  test('(b): 見本は店舗ルール付きで空きを取る', async () => {
    await renderEditor()
    await waitFor(() => { expect(fixture.getAvailability).toHaveBeenCalled() })
    const last = fixture.getAvailability.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(last[0]).toBe('account-a')
    expect(last[1]).toEqual(expect.objectContaining({ applyStoreRules: true }))
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
    const save = screen.getByRole('button', { name: '設備を保存する' })
    act(() => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(fixture.updateResource).toHaveBeenCalledTimes(1)
    await act(async () => { rejectFirst(new Error('network')); await Promise.resolve() })
    expect((await screen.findByRole('alert')).textContent).toContain('入力内容は残っています')
    expect(name.value).toBe('個室B')

    fireEvent.click(screen.getByRole('button', { name: '設備を保存する' }))
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
    // N-411: 紐づけ無しでも店舗の受付枠を見られる staff（予約の閲覧権限あり）は
    // 従来どおり店舗ビューへ進む。閲覧のみで編集はできないことを確かめる。
    window.localStorage.setItem('lh_staff_view_permissions', '["/booking/bookings"]')
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor(true)
    expect((await screen.findByLabelText('個室Aの設備名') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '設備を保存する' })).toBeNull()
    expect(screen.getAllByText(/閲覧のみです/).length).toBeGreaterThan(0)
  })

  test('R312: 書きかけがある停止は破棄確認を挟み、戻れば送らない', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    const name = await screen.findByLabelText('個室Aの設備名') as HTMLInputElement
    fireEvent.change(name, { target: { value: '書きかけ' } })
    fireEvent.change(screen.getByLabelText('個室Aの受付上限'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: '受付を停止' }))

    // 送らずに破棄か継続を選ばせる。
    await screen.findByText('名前・種類・上限の編集中の内容は保存されません。受付の状態だけ変わります。')
    expect(fixture.updateResource).not.toHaveBeenCalled()

    // 編集に戻れば何も送らず、下書きは残る。
    fireEvent.click(screen.getByRole('button', { name: '編集に戻る' }))
    await waitFor(() => expect(screen.queryByText('名前・種類・上限の編集中の内容は保存されません。受付の状態だけ変わります。')).toBeNull())
    expect(fixture.updateResource).not.toHaveBeenCalled()
    expect(name.value).toBe('書きかけ')
    expect((screen.getByLabelText('個室Aの受付上限') as HTMLInputElement).value).toBe('9')
  })

  test('R312: 破棄して停止を選ぶと状態だけ送る', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    fireEvent.change(await screen.findByLabelText('個室Aの設備名'), { target: { value: '書きかけ' } })
    fireEvent.click(screen.getByRole('button', { name: '受付を停止' }))
    await screen.findByText('名前・種類・上限の編集中の内容は保存されません。受付の状態だけ変わります。')

    fireEvent.click(screen.getByRole('button', { name: '破棄して停止' }))
    await waitFor(() => expect(fixture.updateResource).toHaveBeenCalledTimes(1))
    // 状態だけ送る。編集中の値は送らない。
    expect(fixture.updateResource).toHaveBeenLastCalledWith('account-a', 'resource-a', {
      expectedVersion: 1, isActive: false,
    })
  })

  test('R312: 下書きが不正でも保存済み設備の停止は進む', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    // 名前を空にすると保存は通らないが、停止は進む。
    fireEvent.change(await screen.findByLabelText('個室Aの設備名'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '受付を停止' }))
    await screen.findByText('名前・種類・上限の編集中の内容は保存されません。受付の状態だけ変わります。')

    fireEvent.click(screen.getByRole('button', { name: '破棄して停止' }))
    await waitFor(() => expect(fixture.updateResource).toHaveBeenCalledTimes(1))
    expect(fixture.updateResource).toHaveBeenLastCalledWith('account-a', 'resource-a', {
      expectedVersion: 1, isActive: false,
    })
  })

  test('R312: 書きかけがなければ確認なく停止する', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: '受付を停止' }))

    await waitFor(() => expect(fixture.updateResource).toHaveBeenCalledTimes(1))
    expect(fixture.updateResource).toHaveBeenLastCalledWith('account-a', 'resource-a', {
      expectedVersion: 1, isActive: false,
    })
    expect(screen.queryByText('名前・種類・上限の編集中の内容は保存されません。受付の状態だけ変わります。')).toBeNull()
  })

  test('R313: 削除は確認窓を挟み、やめるでは残る', async () => {
    fixture.listResources.mockResolvedValue({ data: { resources: [resource()] } })
    await renderEditor()
    await screen.findByLabelText('個室Aの設備名')

    // 押しただけでは送らない。対象と取り消しの道を確認できる。
    fireEvent.click(screen.getByRole('button', { name: '設備を削除する' }))
    await screen.findByText('削除すると元に戻せません。受付だけ止めたいときは「受付を停止」を使ってください。')
    expect(fixture.deleteResource).not.toHaveBeenCalled()

    // やめるでは残る。
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByText('削除すると元に戻せません。受付だけ止めたいときは「受付を停止」を使ってください。')).toBeNull())
    expect(fixture.deleteResource).not.toHaveBeenCalled()
    expect(screen.getByLabelText('個室Aの設備名')).toBeTruthy()

    // 確定して初めて送る。
    fireEvent.click(screen.getByRole('button', { name: '設備を削除する' }))
    await screen.findByText('削除すると元に戻せません。受付だけ止めたいときは「受付を停止」を使ってください。')
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(fixture.deleteResource).toHaveBeenCalledTimes(1))
    expect(fixture.deleteResource).toHaveBeenCalledWith('account-a', 'resource-a', 1)
  })

  test('account切替直後は旧設備を新accountとして描画せず、旧保存応答も捨てる', async () => {
    fixture.listResources.mockImplementation(async (accountId: string) => ({
      data: { resources: accountId === 'account-a' ? [resource()] : [] },
    }))
    let resolveSave!: (value: unknown) => void
    fixture.updateResource.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    await renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: '設備を保存する' }))
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
    const add = screen.getByRole('button', { name: '設備を追加する' })
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

describe('登録済みの休業日の修正・削除 (#953 E-09)', () => {
  async function renderWithException(exceptions = [exception()]) {
    fixture.getSettings.mockImplementation(async (accountId: string) => ({
      success: true,
      data: settings(accountId, { exceptions }),
    }))
    await renderEditor()
    await screen.findByText('年末休業')
  }

  test('修正するで入力に切り替え、expectedVersion付きで保存して一覧へ反映する', async () => {
    await renderWithException()
    fireEvent.click(screen.getByRole('button', { name: '修正する' }))

    await pickDateByLabel('休業日の終了日', new Date(2027, 0, 3))
    fireEvent.change(screen.getByLabelText('休業日の理由'), { target: { value: '年末年始' } })
    fireEvent.click(screen.getByRole('button', { name: '休業日を保存する' }))

    await waitFor(() => expect(fixture.updateException).toHaveBeenCalledWith('account-a', 'exception-a', expect.objectContaining({
      expectedVersion: 2,
      dateFrom: '2026-12-30',
      dateTo: '2027-01-03',
      reason: '年末年始',
    })))
    await screen.findByText('年末年始')
  })

  test('削除は確認を1枚挟み、expectedVersion付きで送って一覧から消す', async () => {
    await renderWithException()
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))

    // 確認するまでAPIは呼ばない。
    expect(await screen.findByText('この休業日を消しますか？')).toBeTruthy()
    expect(fixture.deleteException).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '休業日を削除する' }))
    await waitFor(() => expect(fixture.deleteException).toHaveBeenCalledWith('account-a', 'exception-a', 2))
    await waitFor(() => expect(screen.queryByText('年末休業')).toBeNull())
  })

  test('削除の版競合は上書きせず、読み直しを案内する', async () => {
    fixture.deleteException.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'version_conflict'))
    await renderWithException()
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))
    fireEvent.click(screen.getByRole('button', { name: '休業日を削除する' }))

    expect((await screen.findByRole('alert')).textContent).toContain('ほかの担当者が先にこの休業日を変更しました')
    // 一覧は消さず、確認をやり直せる状態のままにする。
    expect(screen.getByText('年末休業')).toBeTruthy()
  })

  test('閲覧のみの人には修正・削除の入口を出さない', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    window.localStorage.setItem('lh_staff_view_permissions', '["/booking/bookings"]')
    fixture.getSettings.mockImplementation(async (accountId: string) => ({
      success: true,
      data: settings(accountId, { exceptions: [exception()] }),
    }))
    await renderEditor(true)
    await screen.findByText('年末休業')
    expect(screen.queryByRole('button', { name: '修正する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
  })

  test('R161: 休業日の修正欄を開いたまま別画面へ移ると確認を出す', async () => {
    await renderWithException()
    fireEvent.click(screen.getByRole('button', { name: '修正する' }))
    await screen.findByLabelText('休業日の理由')
    fireEvent.click(screen.getByRole('link', { name: /予約管理/ }))
    await screen.findByText('保存していない変更があります')
    expect(screen.getByRole('button', { name: '保存せずに移る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '編集を続ける' })).toBeTruthy()
  })
})

describe('日時を指定して空きを確認 (IDEA-28)', () => {
  const checkDate = daysAhead(30)
  const checkIso = isoOf(checkDate)
  async function fillCheckForm() {
    await screen.findByLabelText('確認する日付')
    await pickDateByLabel('確認する日付', checkDate)
    await pickTimeByLabel('確認する開始時刻', '11:00')
  }

  test('日時を入れて確かめるとAPIを呼び、取れる旨と残数を表示する', async () => {
    await renderEditor()
    await fillCheckForm()
    fireEvent.change(await screen.findByLabelText('確認する担当'), { target: { value: 's1' } })
    fireEvent.click(screen.getByRole('button', { name: 'この日時を確かめる' }))

    await waitFor(() => expect(fixture.checkAvailability).toHaveBeenCalledWith('account-a', {
      menuId: 'menu-1', staffId: 's1', date: checkIso, time: '11:00',
    }))
    expect((await screen.findByText('この日時は予約を受けられます。')).textContent).toBeTruthy()
    expect(screen.getByText('担当A: 残り 1/1')).toBeTruthy()
  })

  test('取れないときは理由を運用者向けの文で出し、詳細（予定の件名など）は出さない', async () => {
    fixture.checkAvailability.mockResolvedValue({
      date: checkIso,
      time: '11:00',
      timeZone: 'Asia/Tokyo',
      bookable: false,
      reasons: ['other_booking', 'google_busy'],
      per_staff: [
        { staff_id: 's1', display_name: '担当A', bookable: false, remaining: null, capacity: null, reasons: ['google_busy'] },
      ],
    })
    await renderEditor()
    await fillCheckForm()
    fireEvent.click(screen.getByRole('button', { name: 'この日時を確かめる' }))

    expect((await screen.findByText('この日時は予約できません。')).textContent).toBeTruthy()
    expect(screen.getByText('ほかの予約と重なっています')).toBeTruthy()
    expect(screen.getByText('外部カレンダーの予定と重なっています')).toBeTruthy()
  })

  test('日付・時刻が空ならAPIを呼ばず、確認エラーはalertで出す', async () => {
    fixture.checkAvailability.mockRejectedValue(new ApiError(500))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'この日時を確かめる' }))
    expect(fixture.checkAvailability).not.toHaveBeenCalled()

    await fillCheckForm()
    fireEvent.click(screen.getByRole('button', { name: 'この日時を確かめる' }))
    await waitFor(() => expect(fixture.checkAvailability).toHaveBeenCalledTimes(1))
    expect((await screen.findByRole('alert')).textContent).toContain('空き状況を確かめられませんでした')
  })

  test('入力を変えたら前の結果を消して誤読を防ぐ', async () => {
    await renderEditor()
    await fillCheckForm()
    fireEvent.click(screen.getByRole('button', { name: 'この日時を確かめる' }))
    await screen.findByText('この日時は予約を受けられます。')

    await pickDateByLabel('確認する日付', daysAhead(31))
    expect(screen.queryByText('この日時は予約を受けられます。')).toBeNull()
  })
})

describe('予約設備の利用数の形違い（監査A1）', () => {
  test('usage が無くても落ちず「—件」と出す', async () => {
    // 旧偽APIの形（usage なし）。本物は usage まで返す。
    const bare = { ...resource() } as Record<string, unknown>
    delete bare.usage
    fixture.listResources.mockResolvedValue({ data: { resources: [bare] } })
    await renderEditor()
    expect(await screen.findByText(/メニュー —件/)).toBeTruthy()
  })
})
