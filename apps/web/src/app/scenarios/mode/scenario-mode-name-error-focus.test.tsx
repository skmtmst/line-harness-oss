// @vitest-environment happy-dom
/*
 * R172: シナリオ新規作成の必須エラーがスマホの画面外に出る。
 *
 * 名前空欄で画面下の下書き保存を押すと、エラーは画面上方の帯だけに
 * 出て、操作位置（画面下）のままになる。最初の不正入力欄の下にも
 * 短い案内を出し、入力欄へフォーカスとスクロールを移す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    scenarios: {
      create: vi.fn(async () => ({ success: true, data: { id: 'sc-new' } })),
      update: vi.fn(async () => ({ success: false })),
    },
    folders: {
      list: vi.fn(async () => ({ success: true, data: [] })),
    },
  },
}))

import ScenarioModePage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let scrolled: string[]

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  scrolled = []
  ;(window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView =
    vi.fn(function (this: HTMLElement) {
      scrolled.push(this.tagName)
    })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount() {
  await act(async () => {
    root.render(<ScenarioModePage />)
  })
}

function nameInput(): HTMLInputElement {
  const input = host.querySelector('input[placeholder="例: 友だち追加ウェルカム"]') as HTMLInputElement
  expect(input, 'シナリオ名の入力欄が見つかりません').toBeTruthy()
  return input
}

describe('R172 名前空欄の下書き保存する', () => {
  it('入力欄の下に案内を出し、欄へフォーカスとスクロールを移す', async () => {
    await mount()
    const draft = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('あとで決める'),
    ) as HTMLButtonElement
    expect(draft, '下書き保存ボタンが見つかりません').toBeTruthy()
    await act(async () => {
      draft.click()
    })
    // 該当欄の下に短い案内が出る。
    expect(host.textContent).toContain('シナリオ名を入力してください')
    // 該当欄へフォーカスとスクロールが移る（スマホで原因が画面内に見える）。
    expect(document.activeElement).toBe(nameInput())
    expect(scrolled).toContain('INPUT')
    // 読み上げ用に欄と案内を結ぶ。
    expect(nameInput().getAttribute('aria-describedby')).toBe('scenario-name-error')
    expect(nameInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('名前を入れ直すと欄下の案内が消える', async () => {
    await mount()
    const draft = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('あとで決める'),
    ) as HTMLButtonElement
    await act(async () => {
      draft.click()
    })
    expect(host.querySelector('#scenario-name-error')).toBeTruthy()
    const input = nameInput()
    await act(async () => {
      // React の onChange を通すためネイティブ setter を使う。
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '友だち追加ウェルカム')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    expect(host.querySelector('#scenario-name-error')).toBeNull()
  })
})
