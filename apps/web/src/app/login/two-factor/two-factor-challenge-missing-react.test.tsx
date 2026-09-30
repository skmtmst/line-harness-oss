// @vitest-environment happy-dom
import React, { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwoFactorLoginPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * R614: ログインからの合言葉引き継ぎなしで /login/two-factor を直接開いたとき、
 * 6桁を入れても「6桁の認証コードを入力してください」と出してはいけない。
 * 実際に足りないのは合言葉であり、入力のやり直しでは解決しないため、
 * ログインからやり直す理由とリンクを示す。
 * R507残部: メール経路の戻りリンクが「別のLINEアカウントでログイン」のまま。
 * 経路に合わせるか中立の案内にする。LINE経路は既存どおり。
 */

const fixture = vi.hoisted(() => ({
  hash: '',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/login/two-factor',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'テスト統括' }) }))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

async function render() {
  await act(async () => { root.render(<TwoFactorLoginPage />) })
  await settle()
}

/** 6マスへコードを入れる（1マス目へのまとめ入力は全マスへ振り分けられる）。 */
async function enterCode(digits: string) {
  const first = host.querySelectorAll('input')[0] as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(first, digits)
    first.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submitButton() {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('確認してログイン')) as HTMLButtonElement
}

async function submit() {
  await act(async () => { submitButton().click() })
  await settle()
}

beforeEach(() => {
  fixture.hash = ''
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  window.sessionStorage.clear()
  try { window.localStorage.clear() } catch { /* 無い環境では何もしない */ }
  window.history.replaceState(null, '', `/login/two-factor${fixture.hash}`)
  fetchMock = vi.fn(async () => json({ success: true, data: {}, csrfToken: 'csrf-1' }))
  vi.stubGlobal('fetch', fetchMock)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('R614 合言葉なしの直リンク', () => {
  it('認証コード不足と誤案内せず、ログインのやり直しを示す', async () => {
    await render()

    expect(host.textContent).toContain('ログインからやり直してください')
    expect(host.textContent).not.toContain('6桁の認証コードを入力してください')
    // 進み具合で「LINEログイン済み」と断定しない。
    expect(host.textContent).not.toContain('LINEログイン')
    expect(host.textContent).not.toContain('メールログイン')
    // 戻り先はLINE限定にしない。
    expect(host.textContent).toContain('ログインに戻る')
    expect(host.textContent).not.toContain('別のLINEアカウントでログイン')
  })

  it('6桁を入れても誤誘導せず、サーバーへ送らない', async () => {
    await render()
    await enterCode('123456')
    await submit()

    expect(submitButton().disabled).toBe(true)
    expect(host.textContent).toContain('ログインからやり直してください')
    expect(host.textContent).not.toContain('6桁の認証コードを入力してください')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('R507残部 戻りリンクの経路合わせ', () => {
  it('メール経路ではLINE限定の戻りリンクを出さない', async () => {
    window.history.replaceState(null, '', '/login/two-factor#lh_2fa=verify-tok-1&lh_method=password')
    await render()

    expect(host.textContent).toContain('メールログイン')
    expect(host.textContent).toContain('ログインに戻る')
    expect(host.textContent).not.toContain('別のLINEアカウントでログイン')
  })

  it('LINE経路では今までどおりの案内を守る', async () => {
    window.history.replaceState(null, '', '/login/two-factor#lh_2fa=verify-tok-1')
    await render()
    await enterCode('123456')

    expect(host.textContent).toContain('LINEログイン')
    expect(host.textContent).toContain('別のLINEアカウントでログイン')
    expect(host.textContent).not.toContain('ログインからやり直してください')
    expect(submitButton().disabled).toBe(false)
  })
})
