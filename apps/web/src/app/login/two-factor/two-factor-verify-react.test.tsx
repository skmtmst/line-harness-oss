// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwoFactorLoginPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * R506: 通信断では英語の技術文言を出さず、日本語の理由と再試行の案内を出す。
 * R507: メール経路では「LINEログイン済み」と断定せず、実際の方法を出す。
 */

const fixture = vi.hoisted(() => ({
  hash: '#lh_2fa=verify-tok-1',
  verify: null as null | { status: number; body: Record<string, unknown> } | { reject: unknown },
}))

vi.mock('next/link', () => ({ default: () => null }))
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

/* 6桁目が入った瞬間に送られる（動きの点検・6）。ボタンを押す前に返事を待つだけ。 */
async function submit() {
  await settle()
}

beforeEach(() => {
  fixture.hash = '#lh_2fa=verify-tok-1'
  fixture.verify = { status: 200, body: { success: true, data: {}, csrfToken: 'csrf-1' } }
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  window.sessionStorage.clear()
  try { window.localStorage.clear() } catch { /* 無い環境では何もしない */ }
  window.history.replaceState(null, '', `/login/two-factor${fixture.hash}`)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/api/auth/two-factor/verify')) {
      if (fixture.verify && 'reject' in fixture.verify) throw fixture.verify.reject
      const { status, body } = fixture.verify as { status: number; body: Record<string, unknown> }
      return json(body, status)
    }
    return json({ success: false, error: 'unexpected' }, 500)
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('R506 通信断の案内', () => {
  it('通信断では英語を出さず日本語の理由と再試行を出す', async () => {
    fixture.verify = { reject: new TypeError('Failed to fetch') }
    await render()
    await enterCode('123456')
    await submit()

    expect(host.textContent).toContain('接続を確かめて')
    expect(host.textContent).not.toContain('Failed to fetch')
    // 入力は空に戻る（安全な状態へ戻す）。
    for (const input of host.querySelectorAll('input')) {
      expect((input as HTMLInputElement).value).toBe('')
    }
  })

  it('誤コード400は「コードが違います」と人の言葉で出す', async () => {
    fixture.verify = { status: 400, body: { success: false, error: '認証コードが正しくありません' } }
    await render()
    await enterCode('654321')
    await submit()

    expect(host.textContent).toContain('コードが違います。もう一度入れてください')
    expect(host.textContent).not.toContain('接続を確かめて')
  })

  it('回数制限429はサーバーの理由（やり直し先つき）をそのまま出す', async () => {
    fixture.verify = { status: 429, body: { success: false, error: '入力回数を超えました。ログインからやり直してください' } }
    await render()
    await enterCode('654321')
    await submit()

    expect(host.textContent).toContain('入力回数を超えました')
  })
})

describe('R507 ログイン方法の進行表示', () => {
  it('メール経路ではLINEログイン済みと出さない', async () => {
    fixture.hash = '#lh_2fa=verify-tok-1&lh_method=password'
    window.history.replaceState(null, '', `/login/two-factor${fixture.hash}`)
    await render()

    expect(host.textContent).toContain('メールログイン')
    expect(host.textContent).not.toContain('LINEログイン')
  })

  it('LINE経路では今までどおりLINEログインと出す', async () => {
    await render()

    expect(host.textContent).toContain('LINEログイン')
  })

  it('再読込でもメール経路の表示を保つ', async () => {
    fixture.hash = '#lh_2fa=verify-tok-1&lh_method=password'
    window.history.replaceState(null, '', `/login/two-factor${fixture.hash}`)
    await render()
    // 合言葉の受け取りで hash が消えたあとの再読込（作り直して開く）。
    window.history.replaceState(null, '', '/login/two-factor')
    act(() => { root.unmount() })
    host.remove()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await render()

    expect(host.textContent).toContain('メールログイン')
    expect(host.textContent).not.toContain('LINEログイン')
  })
})
