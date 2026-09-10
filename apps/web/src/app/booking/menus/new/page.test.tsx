// @vitest-environment happy-dom
/*
 * E-03 #657: 予約メニュー作成画面の「予約後に付けるタグ」を、実物の React で描いて操作する。
 *
 * ソース文字列の検査では次が固定できない。ここでは happy-dom へ実物の画面を
 * マウントし、実物の Promise を後から解決させて確かめる。
 *
 *   - タグ取得が遅れて返る間の入力が消えないこと、返った後に候補が出ること
 *   - 候補に出るのが「いま選んでいるアカウントの有効なタグ」だけであること
 *     (別アカウント・整理済み(archived)は出ない)
 *   - アカウントを切り替えると前の選択が残らないこと
 *   - 保存 request に auto_tag_id が載ること
 *   - 保存が tag_not_found で落ちても入力が消えず、選び直せること
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type DeferredTags = {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  tagsList: null as null | (() => Promise<unknown>),
  createMenu: null as null | ((...args: unknown[]) => Promise<unknown>),
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

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
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
      mileage: { rules: async () => ({ success: true, data: [] }) },
    },
    bookingApi: {
      createMenu: (...args: unknown[]) => fixture.createMenu!(...args),
      getSettings: async () => ({ success: true, data: { menuCount: 1 } }),
      listStaff: async () => ({ staff: [{ id: 'staff-a', display_name: '担当A', is_active: 1 }] }),
      getStaffMenus: async () => ({ matrix: [] }),
      putStaffMenus: async () => ({ ok: true }),
    },
  }
})

import { ApiError } from '@/lib/api'
import NewBookingMenuPage from './page'

/** 同アカウントの有効タグ／同アカウントの整理済み／別アカウントの有効タグ。 */
const TAGS = [
  { id: 'tag-active', name: '予約済み', color: '#111111', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-active-2', name: '常連さん', color: '#444444', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-archived', name: '旧キャンペーン', color: '#222222', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-a', status: 'archived' },
  { id: 'tag-other-account', name: 'B店のタグ', color: '#333333', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-b', status: 'active' },
  { id: 'tag-b-only', name: 'B店だけの分類', color: '#555555', createdAt: '2026-09-01T00:00:00Z', lineAccountId: 'account-b', status: 'active' },
]

function deferredTags(): DeferredTags {
  let resolve!: (value: unknown) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** メニュー名の入力欄。 */
function nameInput(): HTMLInputElement {
  return screen.getByPlaceholderText('例: トリミング（小型犬）') as HTMLInputElement
}

/** 選べる中身。プルダウンの option をそのまま読む。 */
function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.querySelectorAll('option')].map((option) => option.textContent ?? '')
}

beforeEach(() => {
  fixture.selectedAccountId = 'account-a'
  fixture.tagsList = async () => ({ success: true, data: TAGS })
  fixture.createMenu = vi.fn(async () => ({ id: 'menu-new', version: 1 }))
})

afterEach(() => {
  cleanup()
  accountSetters.clear()
  vi.restoreAllMocks()
})

describe('新規作成画面: 予約後に付けるタグ', () => {
  async function renderNew() {
    render(<NewBookingMenuPage />)
    // 取得が終わるまでは読み込み中の文言を出し、プルダウンは出さない。
    return screen.findByLabelText('予約後に付けるタグ') as Promise<HTMLSelectElement>
  }

  test('タグ取得が遅れて返る間も入力は消えず、返った後に候補が出る', async () => {
    const deferred = deferredTags()
    fixture.tagsList = () => deferred.promise

    render(<NewBookingMenuPage />)

    // まだ返っていない: 読み込み中を出し、選ばせない。
    expect(screen.getByText('タグを読み込んでいます…')).toBeTruthy()
    expect(screen.queryByLabelText('予約後に付けるタグ')).toBeNull()

    // 取得を待っている間にメニュー名を入れる。
    fireEvent.change(nameInput(), { target: { value: 'トリミング' } })

    await act(async () => {
      deferred.resolve({ success: true, data: TAGS })
      await deferred.promise
    })

    // 遅れて返った後も、待っている間の入力はそのまま残る。
    expect(nameInput().value).toBe('トリミング')
    const select = await screen.findByLabelText('予約後に付けるタグ') as HTMLSelectElement
    expect(optionLabels(select)).toEqual(['— なし —', '予約済み', '常連さん'])
  })

  test('取得に失敗しても保存はできる文言を出し、プルダウンは出さない', async () => {
    fixture.tagsList = async () => { throw new Error('network down') }
    render(<NewBookingMenuPage />)

    await waitFor(() => {
      expect(screen.getByText('タグを読み込めませんでした。タグなしで保存できます。')).toBeTruthy()
    })
    expect(screen.queryByLabelText('予約後に付けるタグ')).toBeNull()
  })

  test('候補は対象アカウントの有効タグだけ。整理済みも別アカウントも出さない', async () => {
    const select = await renderNew()
    const labels = optionLabels(select)
    expect(labels).toContain('予約済み')
    expect(labels).not.toContain('旧キャンペーン')
    expect(labels).not.toContain('B店のタグ')
  })

  test('検索で絞り込み、選び、解除できる', async () => {
    const select = await renderNew()

    fireEvent.change(screen.getByLabelText('タグを検索'), { target: { value: '常連' } })
    expect(optionLabels(select)).toEqual(['— なし —', '常連さん'])

    fireEvent.change(select, { target: { value: 'tag-active-2' } })
    expect(select.value).toBe('tag-active-2')

    // 検索を消しても選択は残る。
    fireEvent.click(screen.getByLabelText('検索語を消す'))
    expect(select.value).toBe('tag-active-2')
    expect(optionLabels(select)).toEqual(['— なし —', '予約済み', '常連さん'])

    // 「なし」へ戻せる。
    fireEvent.change(select, { target: { value: '' } })
    expect(select.value).toBe('')
  })

  test('検索に合うタグが無いときは、選択を残したまま合わないことを出す', async () => {
    const select = await renderNew()
    fireEvent.change(select, { target: { value: 'tag-active' } })
    fireEvent.change(screen.getByLabelText('タグを検索'), { target: { value: 'ありえない語' } })

    expect(screen.getByText('「ありえない語」に合うタグがありません。')).toBeTruthy()
    // 選んだタグは隠れても外れない。
    expect(select.value).toBe('tag-active')
  })

  test('アカウントを切り替えると前の選択が残らず、候補も切替先のものになる', async () => {
    const select = await renderNew()
    fireEvent.change(select, { target: { value: 'tag-active' } })
    expect(select.value).toBe('tag-active')

    switchAccount('account-b')

    const afterSwitch = await screen.findByLabelText('予約後に付けるタグ') as HTMLSelectElement
    expect(afterSwitch.value).toBe('')
    expect(optionLabels(afterSwitch)).toEqual(['— なし —', 'B店のタグ', 'B店だけの分類'])

    /*
     * プルダウンの見た目だけでは足りない。候補から外れた値は DOM の側でも
     * 空へ倒れて見えるので、「選択が消えた」のか「候補外の値を抱えたままか」の
     * 区別がつかない。実際に保存まで通して、前アカウントの ID が request へ
     * 載らない(=画面の状態としても消えている)ことを確かめる。
     */
    fireEvent.change(nameInput(), { target: { value: 'B店のメニュー' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '担当A' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })

    await waitFor(() => { expect(fixture.createMenu).toHaveBeenCalled() })
    expect(fixture.createMenu).toHaveBeenCalledWith(
      'account-b',
      expect.objectContaining({ auto_tag_id: null }),
    )
  })

  test('保存 request に選んだ auto_tag_id が載る', async () => {
    const select = await renderNew()
    fireEvent.change(nameInput(), { target: { value: 'トリミング' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '担当A' }))
    fireEvent.change(select, { target: { value: 'tag-active' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })

    await waitFor(() => { expect(fixture.createMenu).toHaveBeenCalled() })
    expect(fixture.createMenu).toHaveBeenCalledWith(
      'account-a',
      expect.objectContaining({ auto_tag_id: 'tag-active' }),
    )
  })

  test('保存が tag_not_found で落ちても入力は残り、選び直せる', async () => {
    fixture.createMenu = vi.fn(async () => {
      throw new ApiError(400, 'tag not found', 'tag_not_found')
    })
    const select = await renderNew()
    fireEvent.change(nameInput(), { target: { value: 'トリミング' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '担当A' }))
    fireEvent.change(select, { target: { value: 'tag-active' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })

    await waitFor(() => {
      expect(screen.getByText('選んだタグは削除されたため保存できませんでした。タグを選び直してください。')).toBeTruthy()
    })
    // 入力は消えない。選び直してもう一度出せる。
    expect(nameInput().value).toBe('トリミング')
    const again = screen.getByLabelText('予約後に付けるタグ') as HTMLSelectElement
    fireEvent.change(again, { target: { value: 'tag-active-2' } })
    expect(again.value).toBe('tag-active-2')
  })
})
