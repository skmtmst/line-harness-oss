// @vitest-environment happy-dom
/*
 * D002: 保存に失敗しても `API error: 405` のような開発者向けの生文面を
 * 出さない。何が起きたか・どうすればよいかを運用者の言葉で出す。
 * D003: フォルダ一覧の取得に失敗したら黙って「未分類」にしない。
 * 失敗を表示して再読み込みを出し、読み込めていない間は保存させない。
 * D001（new）: 作成の口は owner/admin のみ。閲覧だけの担当者の保存ボタンは
 * 理由付きで押せないようにする。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn(),
  folders: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      folders: fixture.folders,
      create: fixture.create,
    },
  }
})

import NewWebinarPage from './page'

/* happy-dom に localStorage は無い。booking 配下と同じ memory stub を置く。 */
const localStorageValues = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
    removeItem: (key: string) => { localStorageValues.delete(key) },
    clear: () => { localStorageValues.clear() },
  },
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.create.mockReset()
  fixture.folders.mockReset()
  fixture.create.mockResolvedValue({ success: true, data: { id: 'new-webinar' } })
  fixture.folders.mockResolvedValue({ success: true, data: [] })
  window.localStorage.setItem('lh_staff_role', 'owner')
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  window.localStorage.clear()
  await act(async () => { root.unmount() })
  host.remove()
})

async function render() {
  await act(async () => { root.render(<NewWebinarPage />) })
  await flush()
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button as HTMLButtonElement
}

async function typeTitle(value: string) {
  await act(async () => {
    fireEvent.change(host.querySelector('#webinar-title')!, { target: { value } })
  })
}

describe('ウェビナー作成の保存失敗文（D002）', () => {
  it('405で失敗しても生文面を出さず、立て直し文を出して入力を残す', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.create.mockRejectedValue(new ApiError(405, 'API error: 405'))
    await render()
    await typeTitle('残したい名前')

    await act(async () => { buttonByText('下書きを保存する').click() })
    await flush()

    expect(fixture.push).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('API error')
    expect(host.textContent).toContain('もう一度お試しください')
    expect((host.querySelector('#webinar-title') as HTMLInputElement).value).toBe('残したい名前')
  })
})

describe('ウェビナー作成のフォルダ取得失敗（D003）', () => {
  it('失敗を黙らせず、再読み込みを出して保存を止める', async () => {
    fixture.folders.mockRejectedValue(new Error('network down'))
    await render()
    await typeTitle('フォルダ確認')

    // 「未分類」だけが残り、失敗の表示と再読み込みが出る。
    expect(host.textContent).toContain('フォルダを読み込めませんでした')
    expect(host.querySelector('#webinar-folder')).not.toBeNull()

    // 読み込めていない間は保存先を確定させない。保存ボタンは押せない。
    expect(buttonByText('下書きを保存する').disabled).toBe(true)
    expect(buttonByText('動画設定へ').disabled).toBe(true)
    await act(async () => { buttonByText('下書きを保存する').click() })
    await flush()
    expect(fixture.create).not.toHaveBeenCalled()
  })

  it('再読み込みで直ったら保存できるようになる', async () => {
    fixture.folders
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ success: true, data: [{ id: 'folder-1', name: '商品説明', count: 2 }] })
    await render()

    expect(host.textContent).toContain('フォルダを読み込めませんでした')

    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('もう一度読み込む'))
    if (!retry) throw new Error('再読み込みボタンが見つかりません')
    await act(async () => { retry.click() })
    await flush()

    expect(host.textContent).not.toContain('フォルダを読み込めませんでした')
    expect(buttonByText('下書きを保存する').disabled).toBe(false)

    await typeTitle('直ったので保存')
    await act(async () => { buttonByText('下書きを保存する').click() })
    await flush()
    expect(fixture.create).toHaveBeenCalledTimes(1)
    expect(fixture.push).toHaveBeenCalledWith('/webinars')
  })
})

describe('ウェビナー作成の権限表示（D001）', () => {
  it('閲覧だけの担当者の保存ボタンは理由付きで押せない', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    await render()

    expect(buttonByText('下書きを保存する').disabled).toBe(true)
    expect(buttonByText('動画設定へ').disabled).toBe(true)
    expect(host.textContent).toContain('オーナーか管理者')

    await act(async () => { buttonByText('下書きを保存する').click() })
    await flush()
    expect(fixture.create).not.toHaveBeenCalled()
  })
})
