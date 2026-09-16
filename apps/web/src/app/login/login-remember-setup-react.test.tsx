// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LoginPage from './page'

/*
 * N-426/N-434: ログイン画面の対照。
 *   - 「7日間ログインを保持する」を選ぶと password/login へ remember:true が乗る
 *   - 選ばなければ remember は false のまま
 *   - TOTP未登録の管理者応答（twoFactorSetup）なら設定画面へ進む
 *   - LINEログインのURLにも remember=1 が乗る
 */

const fixture = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
  loginResponse: { success: true, data: { twoFactorSetup: true, challengeToken: 'setup-tok-1' }, csrfToken: 'csrf-1' } as Record<string, unknown>,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/login',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'テスト統括' }) }))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root

function flush(): Promise<void> {
  return act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  fixture.bodies = []
  fixture.loginResponse = { success: true, data: { twoFactorSetup: true, challengeToken: 'setup-tok-1' }, csrfToken: 'csrf-1' }
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (init?.body) fixture.bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
    if (url.endsWith('/api/auth/password/login')) return json(fixture.loginResponse)
    if (url.endsWith('/api/auth/session')) return json({ success: true, data: { id: 's1', name: 'x' }, csrfToken: 'c' })
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

async function render() {
  await act(async () => { root.render(<LoginPage />) })
  await flush()
}

function field(selector: string): HTMLElement | null {
  return host.querySelector(selector)
}

describe('N-434: 7日間ログインを保持する選択', () => {
  it('チェックを入れると password/login へ remember:true が乗る', async () => {
    await render()
    const checkbox = field('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).toBeTruthy()
    await act(async () => { checkbox.click() })
    expect(checkbox.checked).toBe(true)

    const email = field('#login-email') as HTMLInputElement
    const password = field('#login-password') as HTMLInputElement
    await act(async () => {
      // React の制御入力へ値を入れる
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(email, 'owner@example.com'); email.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(password, 'Abcdefg1'); password.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = host.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(fixture.bodies[0]).toMatchObject({ email: 'owner@example.com', remember: true })
  })

  it('チェックなしなら remember:false で送る', async () => {
    await render()
    const email = field('#login-email') as HTMLInputElement
    const password = field('#login-password') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(email, 'owner@example.com'); email.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(password, 'Abcdefg1'); password.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = host.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(fixture.bodies[0]).toMatchObject({ email: 'owner@example.com', remember: false })
  })
})

describe('N-426: 二段階認証の初回設定へ進む', () => {
  it('twoFactorSetup 応答なら /login/two-factor/setup へ合言葉付きで進む', async () => {
    await render()
    const email = field('#login-email') as HTMLInputElement
    const password = field('#login-password') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(email, 'owner@example.com'); email.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(password, 'Abcdefg1'); password.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = host.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(window.location.pathname).toBe('/login/two-factor/setup')
    expect(new URLSearchParams(window.location.hash.slice(1)).get('lh_2fa')).toBe('setup-tok-1')
  })

  it('LINEログインで保持を選ぶと /api/auth/line?remember=1 へ進む', async () => {
    await render()
    const checkbox = field('input[type="checkbox"]') as HTMLInputElement
    await act(async () => { checkbox.click() })
    const buttons = [...host.querySelectorAll('button')] as HTMLButtonElement[]
    const lineButton = buttons.find((b) => b.textContent?.includes('LINE'))!
    await act(async () => { lineButton.click() })
    expect(window.location.href).toBe('https://api.example.test/api/auth/line?remember=1')
  })

  it('LINEログインで未選択なら remember は付かない', async () => {
    await render()
    const buttons = [...host.querySelectorAll('button')] as HTMLButtonElement[]
    const lineButton = buttons.find((b) => b.textContent?.includes('LINE'))!
    await act(async () => { lineButton.click() })
    expect(window.location.href).toBe('https://api.example.test/api/auth/line')
  })
})
