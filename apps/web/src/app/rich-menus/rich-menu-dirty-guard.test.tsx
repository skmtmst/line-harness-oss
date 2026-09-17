// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/rich-menus/" }
import React, { act } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))
const routerPush = vi.hoisted(() => vi.fn())
const richMenuGet = vi.hoisted(() => vi.fn())
const richMenuUpdate = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => searchParams.value,
  usePathname: () => '/rich-menus/edit',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const selectedAccount = vi.hoisted(() => ({ id: 'acc-1', name: 'テスト店' }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'acc-1',
    selectedAccount,
    accounts: [], loading: false,
  }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

const GROUP = {
  id: 'grp-1', accountId: 'acc-1', name: 'メインメニュー', chatBarText: 'メニュー',
  size: 'large' as const, defaultPageId: 'pg-1', isDefaultForAll: false,
  status: 'draft' as const, publishingAt: null,
  targetingCondition: null, targetingPriority: 0, targetingEnabled: false,
  folderId: null,
  pages: [{
    id: 'pg-1', orderIndex: 0, name: 'トップ', aliasId: '',
    lineRichmenuId: null, imageR2Key: null, imageContentType: null, areas: [],
  }],
}

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    templates: { list: () => Promise.resolve({ success: true, data: [] }) },
    forms: { list: () => Promise.resolve({ success: true, data: [] }) },
    trackedLinks: { list: () => Promise.resolve({ success: true, data: [] }) },
    richMenuGroups: {
      get: richMenuGet,
      update: richMenuUpdate,
      tapStats: () => Promise.resolve({ success: true, data: { byArea: [] } }),
      list: () => Promise.resolve({ success: true, data: [] }),
      listSchedules: () => Promise.resolve({ success: true, data: [] }),
      previewTargets: () => Promise.resolve({ success: true, data: null }),
      imageUrl: (key: string) => `/img/${key}`,
    },
  },
}))

import NewRichMenuPage from './new/page'
import RichMenuEditPage from './edit/page'

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

async function type(input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  // happy-dom は <a href> のクリックで実際に location を動かすため、
  // 先行テストの遷移が残らないよう毎回URLを戻す。
  ;(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM
    .setURL('http://localhost/rich-menus/')
  searchParams.value = new URLSearchParams()
  routerPush.mockReset()
  richMenuGet.mockReset()
  richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP }))
  richMenuUpdate.mockReset()
  richMenuUpdate.mockImplementation(() => Promise.resolve({ success: true, data: GROUP }))
})

afterEach(() => {
  cleanup()
})

describe('リッチメニュー新規作成の未保存ガード (N-162)', () => {
  test('未入力のまま一覧リンクを押しても確認は出ない', async () => {
    render(<NewRichMenuPage />)
    await flush()

    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('入力中の内容があります')).toBeNull()
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('入力後に一覧リンクを押すと確認が出て、続けるを選ぶと残る', async () => {
    render(<NewRichMenuPage />)
    await flush()

    await type(screen.getByLabelText('メニュー名'), '季節メニュー')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()

    // 確認窓が出て遷移は止まる
    expect(screen.getByText('入力中の内容があります')).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()

    // 「入力を続ける」で閉じる
    fireEvent.click(screen.getByText('入力を続ける'))
    await flush()
    expect(screen.queryByText('入力中の内容があります')).toBeNull()
    // 入力は残る
    expect((screen.getByLabelText('メニュー名') as HTMLInputElement).value).toBe('季節メニュー')
  })

  test('確認で「保存せずに移動」を選ぶと遷移する', async () => {
    render(<NewRichMenuPage />)
    await flush()

    await type(screen.getByLabelText('メニュー名'), '季節メニュー')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    fireEvent.click(screen.getByText('保存せずに移動'))
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/rich-menus')
  })

  test('入力中の再読み込みはbeforeunloadで止まる', async () => {
    render(<NewRichMenuPage />)
    await flush()

    await type(screen.getByLabelText('メニュー名'), '季節メニュー')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('リッチメニュー編集の未保存ガード (N-162)', () => {
  test('読み込み直後は変更なしなので一覧リンクを押しても確認は出ない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    await screen.findByDisplayValue('メインメニュー')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })

  test('変更後に一覧リンクを押すと確認が出る', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    const nameInput = await screen.findByDisplayValue('メインメニュー')
    await type(nameInput, 'メインメニュー改')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()

    expect(screen.getByText('保存していない変更があります')).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('保存し終わると警告は出なくなる', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    const nameInput = await screen.findByDisplayValue('メインメニュー')
    await type(nameInput, 'メインメニュー改')
    // 保存（update→再読込で署名が更新される）
    fireEvent.click(screen.getByText('下書きに保存'))
    await act(async () => { await Promise.resolve() })
    await flush()

    expect(richMenuUpdate).toHaveBeenCalled()
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })

  test('ステップ移動は同一画面の段階移動なので確認を出さない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    const nameInput = await screen.findByDisplayValue('メインメニュー')
    await type(nameInput, 'メインメニュー改')
    // StepHeader の「誰に出すか」（step=targeting）を押しても、入力は消えない画面内移動
    const stepButton = screen.getAllByText('誰に出すか').find((el) => el.closest('button'))
    fireEvent.click(stepButton!.closest('button')!)
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
    expect(routerPush).toHaveBeenCalledWith('/rich-menus/edit?id=grp-1&step=targeting')
  })
})
