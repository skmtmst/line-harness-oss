// @vitest-environment happy-dom
/*
 * E-03 #657: 予約メニュー一覧の編集窓「予約申込時に自動付与するタグ」を、
 * 実物の React で描いて操作する。
 *
 * ソース文字列の検査では次が固定できない。ここでは happy-dom へ実物の画面を
 * マウントし、一覧の取得を実物の Promise で返してから編集窓を開いて確かめる。
 *
 *   - 候補に出るのが「いま選んでいるアカウントの有効なタグ」だけであること
 *     (別アカウント・整理済み(archived)は出ない)
 *   - 設定済みのタグが整理済み・別アカウントになっていたら、黙って「なし」へ
 *     倒さず、使えないことを出して選び直させること
 *   - 選び直した値が保存 request に載ること
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const localStorageValues = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
    removeItem: (key: string) => { localStorageValues.delete(key) },
    clear: () => { localStorageValues.clear() },
  },
})

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  activeTab: 'menus',
  tagsList: null as null | (() => Promise<unknown>),
  updateMenu: null as null | ((...args: unknown[]) => Promise<unknown>),
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  getSettings: null as null | ((...args: unknown[]) => Promise<unknown>),
  saveSettings: null as null | ((...args: unknown[]) => Promise<unknown>),
  listResources: null as null | ((...args: unknown[]) => Promise<unknown>),
  saveMenuResources: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

/**
 * account 切替を「実物の React 再レンダー」として起こす口。
 * context を差し替えるのではなく、購読している state を動かすので、
 * 切替後の useEffect（選択の初期化）も本番と同じ順で走る。
 */
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: useControllableAccount() }),
}))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => <nav aria-label="予約設定のタブ" />,
  useMergedTab: () => fixture.activeTab,
}))

vi.mock('@/app/booking/staff/page', () => ({
  default: () => <section>担当スタッフ</section>,
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    code: string | undefined
    constructor(status: number, message?: string, code?: string) {
      super(message || `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
    }
  }
  return {
    ApiError,
    api: {
      tags: { list: (...args: unknown[]) => fixture.tagsList!(...(args as [])) },
    },
    bookingApi: {
      updateMenu: (...args: unknown[]) => fixture.updateMenu!(...args),
      listMenus: (...args: unknown[]) => fixture.listMenus!(...args),
      patchMenu: async () => ({ ok: true }),
      getSettings: (...args: unknown[]) => fixture.getSettings!(...args),
      saveSettings: (...args: unknown[]) => fixture.saveSettings!(...args),
      listResources: (...args: unknown[]) => fixture.listResources!(...args),
      saveMenuResources: (...args: unknown[]) => fixture.saveMenuResources!(...args),
    },
  }
})

import MenusPage from './page'
import { ApiError } from '@/lib/api'

/** 同アカウントの有効タグ／同アカウントの整理済み／別アカウントの有効タグ。 */
const TAGS = [
  { id: 'tag-active', name: '予約済み', color: '#111111', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-active-2', name: '常連さん', color: '#444444', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-archived', name: '旧キャンペーン', color: '#222222', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'archived' },
  { id: 'tag-other-account', name: 'B店のタグ', color: '#333333', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-b', status: 'active' },
  { id: 'tag-b-only', name: 'B店だけの分類', color: '#555555', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-b', status: 'active' },
]

const SETTINGS = {
  id: null,
  lineAccountId: 'account-a',
  organizationName: '本店',
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
  businessHours: [],
  exceptions: [],
  updatedAt: '2026-09-01T00:00:00+09:00',
}

/** 選べる中身。プルダウンの option をそのまま読む。 */
function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.querySelectorAll('option')].map((option) => option.textContent ?? '')
}

beforeEach(() => {
  window.localStorage.setItem('lh_staff_role', 'owner')
  fixture.selectedAccountId = 'account-a'
  fixture.activeTab = 'menus'
  fixture.tagsList = async () => ({ success: true, data: TAGS })
  fixture.updateMenu = vi.fn(async () => ({ ok: true }))
  fixture.listMenus = vi.fn(async () => ({ menus: [] }))
  fixture.getSettings = vi.fn(async () => ({ success: true, data: SETTINGS }))
  fixture.saveSettings = vi.fn(async (_accountId, body: Record<string, unknown>) => ({
    success: true,
    data: { ...SETTINGS, ...body, id: 'settings-a', version: 1 },
  }))
  fixture.listResources = vi.fn(async () => ({ data: { resources: [
    { id: 'room-a', name: '個室A', type: 'room', capacity: 3, isActive: true, version: 1 },
    { id: 'seat-a', name: '席A', type: 'seat', capacity: 2, isActive: true, version: 1 },
  ] } }))
  fixture.saveMenuResources = vi.fn(async (_accountId, _menuId, body: { expectedVersion: number; resources: unknown[] }) => ({
    success: true, data: { id: 'menu-1', version: body.expectedVersion + 1, resources: body.resources },
  }))
})

afterEach(() => {
  cleanup()
  accountSetters.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('既存メニューの編集窓: 共有設備の割当', () => {
  function menu() {
    return {
      id: 'menu-1', name: 'カット', category_label: null, description: null,
      duration_minutes: 60, buffer_after_minutes: 0, base_price: 8000,
      price_mode: 'fixed', sort_order: 0, is_active: 1, auto_tag_id: null,
      concurrent_capacity: 1, booking_window_days: null, cutoff_hours_before: null,
      cancel_deadline_hours_before: null, intake_question: null, assigned_staff: [{ id: 'staff-a', display_name: '担当A' }],
      assigned_resources: [{
        menuId: 'menu-1', resourceId: 'room-a', name: '個室A', type: 'room', capacity: 3,
        quantity: 1, isActive: true, warning: null,
      }],
      version: 1,
    }
  }

  async function openEditor() {
    fixture.listMenus = vi.fn(async () => ({ menus: [menu()] }))
    render(<MenusPage />)
    fireEvent.click(await screen.findByRole('button', { name: '中身を見る' }))
    await screen.findByText('メニュー編集')
  }

  test('複数選択・quantityを独立保存し、連打しても1要求だけ送る', async () => {
    let resolveSave!: (value: unknown) => void
    fixture.saveMenuResources = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    await openEditor()
    await screen.findByText('席A')
    fireEvent.click(screen.getByRole('checkbox', { name: /席A/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '個室Aの必要数' }), { target: { value: '2' } })
    const saveButton = screen.getByRole('button', { name: '設備の割当を保存' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    expect(fixture.saveMenuResources).toHaveBeenCalledTimes(1)
    expect(fixture.saveMenuResources).toHaveBeenCalledWith('account-a', 'menu-1', {
      expectedVersion: 1,
      resources: [{ resourceId: 'room-a', quantity: 2 }, { resourceId: 'seat-a', quantity: 1 }],
    })
    await act(async () => {
      resolveSave({ success: true, data: { id: 'menu-1', version: 2, resources: [] } })
      await Promise.resolve()
    })
    expect(screen.getByRole('status').textContent).toContain('設備の割当を保存しました')
  })

  test('409でも入力を保持し、最新内容の読み直しを案内する', async () => {
    fixture.saveMenuResources = vi.fn(async () => { throw new ApiError(409, 'conflict', 'version_conflict') })
    await openEditor()
    const quantity = await screen.findByRole('spinbutton', { name: '個室Aの必要数' })
    fireEvent.change(quantity, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '設備の割当を保存' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('最新の内容を読み直して'))
    expect((quantity as HTMLInputElement).value).toBe('2')
  })

  test('account切替後に旧保存応答を画面へ反映しない', async () => {
    let resolveSave!: (value: unknown) => void
    fixture.saveMenuResources = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: '設備の割当を保存' }))
    switchAccount('account-b')
    await act(async () => {
      resolveSave({ success: true, data: { id: 'menu-1', version: 2, resources: [] } })
      await Promise.resolve()
    })
    expect(screen.queryByText('設備の割当を保存しました。新しい予約枠から反映されます。')).toBeNull()
    expect(screen.queryByText('メニュー編集')).toBeNull()
  })

  test('staffは割当を閲覧できるが変更・保存できない', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    await openEditor()
    expect(await screen.findByText('設備の割当は閲覧のみです。変更は管理者へ依頼してください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '設備の割当を保存' })).toBeNull()
    expect((screen.getByRole('checkbox', { name: /個室A/ }) as HTMLInputElement).disabled).toBe(true)
  })
})

describe('既存メニューの編集窓: 予約申込時に自動付与するタグ', () => {
  function menu(overrides: Record<string, unknown> = {}) {
    return {
      id: 'menu-1',
      name: 'カット',
      category_label: null,
      description: null,
      duration_minutes: 60,
      buffer_after_minutes: 0,
      base_price: 8000,
      price_mode: 'fixed',
      sort_order: 0,
      is_active: 1,
      auto_tag_id: null as string | null,
      concurrent_capacity: 1,
      booking_window_days: null,
      cutoff_hours_before: null,
      cancel_deadline_hours_before: null,
      intake_question: null,
      assigned_staff: [{ id: 'staff-a', display_name: '担当A' }],
      version: 1,
      ...overrides,
    }
  }

  /** 一覧を描き、「中身を見る」で編集窓まで開く。 */
  async function openEditor(target: Record<string, unknown>) {
    fixture.listMenus = vi.fn(async () => ({ menus: [menu(target)] }))
    render(<MenusPage />)
    const row = await screen.findByRole('button', { name: '中身を見る' })
    await act(async () => { fireEvent.click(row) })
    const dialog = await screen.findByText('メニュー編集')
    return dialog.closest('div')!.parentElement as HTMLElement
  }

  function autoTagSelect(): HTMLSelectElement {
    // 編集窓の中で「予約申込時に自動付与するタグ」の直後にあるプルダウン。
    const label = screen.getByText('予約申込時に自動付与するタグ')
    const field = label.parentElement as HTMLElement
    return within(field).getByRole('combobox') as HTMLSelectElement
  }

  test('候補は対象アカウントの有効タグだけ。整理済みも別アカウントも出さない', async () => {
    await openEditor({ auto_tag_id: null })
    const labels = optionLabels(autoTagSelect())
    expect(labels).toEqual(['— なし —', '予約済み', '常連さん'])
    expect(labels).not.toContain('旧キャンペーン')
    expect(labels).not.toContain('B店のタグ')
  })

  test('アカウントを切り替えると、候補も切替先の有効タグになる', async () => {
    /*
     * タグ一覧の取得は初回の1度きり(依存が空)。切替のたびに取り直さないため、
     * 絞り込みが account を見ていないと、B店を選んでいるのに A店のタグが
     * 並んだままになる。切替後にもう一度編集窓を開いて確かめる。
     */
    await openEditor({ auto_tag_id: null })
    expect(optionLabels(autoTagSelect())).toEqual(['— なし —', '予約済み', '常連さん'])

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    switchAccount('account-b')

    const row = await screen.findByRole('button', { name: '中身を見る' })
    await act(async () => { fireEvent.click(row) })
    await screen.findByText('メニュー編集')
    expect(optionLabels(autoTagSelect())).toEqual(['— なし —', 'B店のタグ', 'B店だけの分類'])
  })

  test('設定済みのタグが整理済みなら、黙って「なし」にせず選び直させる', async () => {
    await openEditor({ auto_tag_id: 'tag-archived' })
    const select = autoTagSelect()

    // 値は残す。勝手に「なし」へ倒して気付かないまま保存させない。
    expect(select.value).toBe('tag-archived')
    expect(optionLabels(select)).toContain('旧キャンペーン（今は使えません）')
    expect(screen.getByText(
      '設定されていたタグは整理済みか、このアカウントのタグではありません。選び直すか「なし」にしてください。',
    )).toBeTruthy()
  })

  test('設定済みのタグが別アカウントのものでも、同じように選び直させる', async () => {
    await openEditor({ auto_tag_id: 'tag-other-account' })
    expect(autoTagSelect().value).toBe('tag-other-account')
    expect(screen.getByText(
      '設定されていたタグは整理済みか、このアカウントのタグではありません。選び直すか「なし」にしてください。',
    )).toBeTruthy()
  })

  test('選び直して保存すると、新しい auto_tag_id が保存 request に載る', async () => {
    await openEditor({ auto_tag_id: 'tag-archived' })
    fireEvent.change(autoTagSelect(), { target: { value: 'tag-active-2' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    await waitFor(() => { expect(fixture.updateMenu).toHaveBeenCalled() })
    expect(fixture.updateMenu).toHaveBeenCalledWith(
      'account-a',
      'menu-1',
      expect.objectContaining({ auto_tag_id: 'tag-active-2' }),
    )
  })

  test('使えるタグが1つも無いアカウントでは、タグなしで保存できることを出す', async () => {
    fixture.tagsList = async () => ({ success: true, data: [TAGS[3]] })
    await openEditor({ auto_tag_id: null })
    expect(optionLabels(autoTagSelect())).toEqual(['— なし —'])
    expect(screen.getByText('このアカウントに使えるタグがありません。タグなしで保存できます。')).toBeTruthy()
  })
})

describe('店舗共通の予約ルール', () => {
  test('行が無い店舗の既定値を編集し、version=0で初回保存する', async () => {
    fixture.activeTab = 'rules'
    render(<MenusPage />)

    const windowDays = await screen.findByRole('spinbutton', { name: '何日先まで受け付けるか' })
    expect((windowDays as HTMLInputElement).value).toBe('60')
    fireEvent.change(windowDays, { target: { value: '90' } })
    fireEvent.change(screen.getByRole('combobox', { name: /予約の承認/ }), {
      target: { value: 'manual' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '基本ルールを作成' }))
    })

    await waitFor(() => { expect(fixture.saveSettings).toHaveBeenCalled() })
    expect(fixture.saveSettings).toHaveBeenCalledWith('account-a', expect.objectContaining({
      expectedVersion: 0,
      bookingWindowDays: 90,
      approvalMode: 'manual',
      slotGranularityMinutes: 15,
    }))
    expect((await screen.findByRole('status')).textContent).toContain('予約の基本ルールを保存しました。')
  })

  test('版競合は自動上書きせず、最新内容の読み直しを案内する', async () => {
    fixture.activeTab = 'rules'
    fixture.getSettings = vi.fn(async () => ({ success: true, data: { ...SETTINGS, id: 'settings-a', version: 3 } }))
    fixture.saveSettings = vi.fn(async () => {
      throw new ApiError(409, 'version_conflict', 'version_conflict')
    })
    render(<MenusPage />)

    await screen.findByRole('button', { name: '変更を保存' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    })

    expect((await screen.findByRole('alert')).textContent).toContain('ほかの担当者が先に保存しました。')
    expect(screen.getByRole('button', { name: '最新の内容を読み直す' })).toBeTruthy()
  })

  test('既存行は読み込んだversionを付けて更新する', async () => {
    fixture.activeTab = 'rules'
    fixture.getSettings = vi.fn(async () => ({ success: true, data: { ...SETTINGS, id: 'settings-a', version: 3 } }))
    fixture.saveSettings = vi.fn(async (_accountId, body: Record<string, unknown>) => ({
      success: true,
      data: { ...SETTINGS, ...body, id: 'settings-a', version: 4 },
    }))
    render(<MenusPage />)

    const holdMinutes = await screen.findByRole('spinbutton', { name: '仮押さえの保持時間' })
    fireEvent.change(holdMinutes, { target: { value: '30' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    })

    await waitFor(() => { expect(fixture.saveSettings).toHaveBeenCalled() })
    expect(fixture.saveSettings).toHaveBeenCalledWith('account-a', expect.objectContaining({
      expectedVersion: 3,
      holdMinutes: 30,
    }))
    expect((await screen.findByRole('status')).textContent).toContain('予約の基本ルールを保存しました。')
  })

  test('保存待ち中に店舗を切り替えても、旧店舗の応答を新店舗へ反映しない', async () => {
    fixture.activeTab = 'rules'
    fixture.getSettings = vi.fn(async (accountId: string) => ({
      success: true,
      data: accountId === 'account-b'
        ? { ...SETTINGS, id: 'settings-b', lineAccountId: 'account-b', version: 2, bookingWindowDays: 30 }
        : SETTINGS,
    }))
    let resolveOldSave!: (value: unknown) => void
    fixture.saveSettings = vi.fn(() => new Promise((resolve) => { resolveOldSave = resolve }))
    render(<MenusPage />)

    await screen.findByRole('button', { name: '基本ルールを作成' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '基本ルールを作成' }))
    })
    switchAccount('account-b')

    const currentWindowDays = await screen.findByRole('spinbutton', { name: '何日先まで受け付けるか' })
    await waitFor(() => { expect((currentWindowDays as HTMLInputElement).value).toBe('30') })
    await act(async () => {
      resolveOldSave({
        success: true,
        data: { ...SETTINGS, id: 'settings-a', version: 1, bookingWindowDays: 90 },
      })
      await Promise.resolve()
    })

    expect((screen.getByRole('spinbutton', { name: '何日先まで受け付けるか' }) as HTMLInputElement).value).toBe('30')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
