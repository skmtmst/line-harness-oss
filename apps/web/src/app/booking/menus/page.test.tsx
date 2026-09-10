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

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  tagsList: null as null | (() => Promise<unknown>),
  updateMenu: null as null | ((...args: unknown[]) => Promise<unknown>),
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
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
  useMergedTab: () => 'menus',
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
      getSettings: async () => ({ success: true, data: { menuCount: 1 } }),
    },
  }
})

import MenusPage from './page'

/** 同アカウントの有効タグ／同アカウントの整理済み／別アカウントの有効タグ。 */
const TAGS = [
  { id: 'tag-active', name: '予約済み', color: '#111111', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-active-2', name: '常連さん', color: '#444444', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-archived', name: '旧キャンペーン', color: '#222222', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'archived' },
  { id: 'tag-other-account', name: 'B店のタグ', color: '#333333', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-b', status: 'active' },
  { id: 'tag-b-only', name: 'B店だけの分類', color: '#555555', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-b', status: 'active' },
]

/** 選べる中身。プルダウンの option をそのまま読む。 */
function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.querySelectorAll('option')].map((option) => option.textContent ?? '')
}

beforeEach(() => {
  fixture.selectedAccountId = 'account-a'
  fixture.tagsList = async () => ({ success: true, data: TAGS })
  fixture.updateMenu = vi.fn(async () => ({ ok: true }))
  fixture.listMenus = vi.fn(async () => ({ menus: [] }))
})

afterEach(() => {
  cleanup()
  accountSetters.clear()
  vi.restoreAllMocks()
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
