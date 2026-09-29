// @vitest-environment happy-dom
/*
 * カルーセル編集の未保存ガード（D009）を、実際に mount して確かめる。
 *
 * 複数パネルを組み立てた状態で「キャンセル」を押しても、以前は確認なしで
 * 一覧へ遷移し、途中の作業が警告なく消えた。いまは共通の番兵
 * `useUnsavedGuard`＋確認窓で止め、「保存せずに移動」を選んだときだけ進む。
 *
 * 差し替えるのは通信と遷移と文脈だけ。画面の判断は差し替えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* `@/lib/api` は読み込んだ時点で API の宛先を要求する。 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://worker.example.com'
})

const routing = vi.hoisted(() => ({
  params: new URLSearchParams(),
  pushed: [] as string[],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => routing.pushed.push(href),
    replace: (href: string) => routing.pushed.push(href),
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  useSearchParams: () => routing.params,
  usePathname: () => '/templates/carousel',
}))

/* Link は行き先を出すだけの部品。画面の判断とは関わらない。 */
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'account-a', name: 'A店' }],
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: 'A店' },
    setSelectedAccountId: () => {},
    clearSelectedAccountId: () => {},
    refreshAccounts: async () => {},
    loading: false,
  }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({
    status: 'ready',
    features: { friend_fields: true, common_vars: true },
    enabled: () => true,
  }),
}))

const calls = vi.hoisted(() => ({
  foldersList: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const empty = async () => ({ success: true as const, data: [] as never[] })
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: { ...actual.api.folders, list: calls.foldersList },
      tags: { ...actual.api.tags, list: empty },
      friendFields: { ...actual.api.friendFields, list: empty },
      supportMarks: { ...actual.api.supportMarks, list: empty },
      scenarios: { ...actual.api.scenarios, list: empty },
      commonVars: { ...actual.api.commonVars, list: empty },
    },
  }
})

import CarouselEditorPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function mountAt(search: string) {
  routing.params = new URLSearchParams(search)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(CarouselEditorPage)) })
  await settle()
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function allIn(scope: ParentNode, tag: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll(tag)) as HTMLElement[]
}

/** 見出しや札の文字で1つ選ぶ。運用の人が画面で読む言葉で探す。 */
function byText(tag: string, text: string): HTMLElement | null {
  return allIn(container, tag).find((element) => element.textContent?.trim() === text) ?? null
}

/* 確認窓は document.body へ運ばれるので、画面全体から探す。 */
function dialogByText(tag: string, text: string): HTMLElement | null {
  return allIn(document, tag).find((element) => element.textContent?.trim() === text) ?? null
}

const nameInput = () => document.getElementById('cr-name') as HTMLInputElement | null
const cancelLink = () => byText('a', 'キャンセル')

/** 入力の欄へ、画面と同じく入力の出来事で入れる。 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

beforeEach(() => {
  routing.pushed = []
  calls.foldersList.mockReset()
  calls.foldersList.mockResolvedValue({ success: true, data: [] })
  const store = new Map<string, string>([['lh_staff_role', 'owner']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('D009: 未保存のままキャンセルすると確認が出る', () => {
  it('名前を打ってからキャンセルすると確認窓が出て、選ぶまで一覧へ進まない', async () => {
    await mountAt('')
    await act(async () => { typeInto(nameInput()!, '夏の新作セット') })
    await settle()

    await act(async () => { click(cancelLink()!) })
    await settle()

    // 確認なしの遷移はしない。
    expect(routing.pushed).toEqual([])
    expect(dialogByText('h2', '保存していない変更があります')).not.toBeNull()
    expect(dialogByText('button', '保存せずに移動')).not.toBeNull()
  })

  it('「保存せずに移動」を選んだときだけ一覧へ進む', async () => {
    await mountAt('')
    await act(async () => { typeInto(nameInput()!, '夏の新作セット') })
    await settle()
    await act(async () => { click(cancelLink()!) })
    await settle()

    await act(async () => { click(dialogByText('button', '保存せずに移動')!) })
    await settle()

    expect(routing.pushed).toEqual(['/templates'])
  })

  it('「編集を続ける」を選ぶと残って、入力も残る', async () => {
    await mountAt('')
    await act(async () => { typeInto(nameInput()!, '夏の新作セット') })
    await settle()
    await act(async () => { click(cancelLink()!) })
    await settle()

    await act(async () => { click(dialogByText('button', '編集を続ける')!) })
    await settle()

    expect(routing.pushed).toEqual([])
    expect(nameInput()!.value).toBe('夏の新作セット')
  })

  it('何も触っていなければ確認は出ない（止めない）', async () => {
    await mountAt('')

    await act(async () => { click(cancelLink()!) })
    await settle()

    // 番兵は止めない。進む役は Link 本体なので、行き先が残っていることだけ見る。
    expect(dialogByText('h2', '保存していない変更があります')).toBeNull()
    expect(dialogByText('button', '保存せずに移動')).toBeNull()
    expect(cancelLink()!.getAttribute('href')).toBe('/templates')
    expect(routing.pushed).toEqual([])
  })
})
