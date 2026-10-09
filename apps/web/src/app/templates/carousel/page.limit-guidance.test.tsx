// @vitest-environment happy-dom
/*
 * R621: 画像もタイトルもない本文の120文字上限と、一律60文字の注意文の矛盾。
 *
 * 決まり（送信境界・Worker の carousel-validation と同じ）は変えない。
 * タイトルか画像があるパネルは60文字、両方なければ120文字。
 * この試験は、その決まりが画面の3か所（欄の注記・文字数カウンタ・
 * 「気をつけること」）で食い違わずに出ることを、実際に組み立てて確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

async function mountNew() {
  routing.params = new URLSearchParams('')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(CarouselEditorPage)) })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** 入力の欄へ、画面と同じく入力の出来事で入れる。 */
function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 「気をつけること」の中のパネル本文の行。 */
function bodyCaution(): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll('li')).find((element) =>
      element.textContent?.includes('パネル本文は'),
    ) ?? null
  )
}

const titleInput = () => document.getElementById('cr-panel-0-title') as HTMLInputElement | null
const bodyInput = () => document.getElementById('cr-panel-0-text') as HTMLTextAreaElement | null
/** 本文カウンタ（「0 / 120」の形）。 */
function bodyCounter(): HTMLElement | null {
  const area = bodyInput()
  return (area?.parentElement?.querySelector('p.tabular-nums') as HTMLElement | null) ?? null
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
  container?.remove()
  vi.unstubAllGlobals()
})

describe('R621: 本文の上限案内は画像・タイトルの有無と食い違わない', () => {
  it('両方なければ120文字で案内し、注意文も120文字をうたう', async () => {
    await mountNew()
    // 欄のそばの注記とカウンタは120文字。
    expect(bodyCounter()?.textContent).toBe('0 / 120')
    expect(container.textContent).toContain('120文字まで')
    // 「気をつけること」は一律60文字ではなく、両方の条件を書く。
    const caution = bodyCaution()?.textContent ?? ''
    expect(caution).toContain('60文字')
    expect(caution).toContain('120文字')
  })

  it('タイトルを入れると60文字に切り替わる', async () => {
    await mountNew()
    await act(async () => { typeInto(titleInput()!, '夏の定番セット') })
    expect(bodyCounter()?.textContent).toBe('0 / 60')
    expect(container.textContent).toContain('タイトルか画像があるため60文字までです')
  })

  it('送信境界はそのまま：タイトルあり61文字は超過、なし120文字は収まる', async () => {
    await mountNew()
    // 両方なしで120文字ちょうどは赤くならない。
    await act(async () => { typeInto(bodyInput()!, 'あ'.repeat(120)) })
    expect(bodyCounter()?.textContent).toBe('120 / 120')
    expect(bodyCounter()?.className).not.toContain('text-danger')
    // タイトルを足すと上限が60に下がり、同じ本文が超過になる。
    await act(async () => { typeInto(titleInput()!, '見出し') })
    expect(bodyCounter()?.textContent).toBe('120 / 60')
    expect(bodyCounter()?.className).toContain('text-danger')
  })
})

describe('J60utH: 右の欄に届き方の見出しが出る', () => {
  it('スマホの見本の上に「届き方」', async () => {
    document.documentElement.dataset.theme = 'v8'
    await mountNew()
    delete document.documentElement.dataset.theme
    const heading = Array.from(container.querySelectorAll('h2')).find(
      (element) => element.textContent === '届き方',
    )
    expect(heading).toBeTruthy()
  })
})
