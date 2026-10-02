// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsLoginPage from './page'

/*
 * M041: 運営ログインのパスワード送信が 503 { success:false, error:'audit_unavailable' } で
 * 返っても、生の audit_unavailable を出さず、日本語の失敗理由と再試行案内を出す。
 * 入力値は保持し、busy を戻す。401 の日本語・429 の混雑案内・2FA/成功の既存仕様は保つ。
 */

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'musubo' }) }))

let host: HTMLDivElement
let root: Root
let responder: (status: number, body: unknown) => void

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const out = handler(String(input), init)
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } })
  }))
}

function setInput(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function submitForm() {
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  window.history.replaceState(null, '', '/ops/login')
  window.sessionStorage.clear()
  responder = () => {}
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('運営ログインの失敗理由案内（M041）', () => {
  it('503 audit_unavailable は生コードを出さず日本語の理由と再試行案内を出す', async () => {
    mockFetch(() => ({ status: 503, body: { success: false, error: 'audit_unavailable' } }))
    await act(async () => { root.render(<OpsLoginPage />) })
    setInput('#ops-login-email', 'ops@example.com')
    setInput('#ops-login-password', 'Passw0rd1')
    await submitForm()

    const alert = host.querySelector('[role="alert"]')?.textContent ?? ''
    expect(alert).not.toContain('audit_unavailable')
    expect(alert).toContain('もう一度お試しください')
    // 入力値は保持される。
    expect((host.querySelector('#ops-login-email') as HTMLInputElement).value).toBe('ops@example.com')
    expect((host.querySelector('#ops-login-password') as HTMLInputElement).value).toBe('Passw0rd1')
    // busy が戻り、再送信できる。
    expect(host.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('401 の日本語（不正ログイン）はそのまま出す', async () => {
    mockFetch(() => ({ status: 401, body: { success: false, error: 'メールアドレスかパスワードが違います' } }))
    await act(async () => { root.render(<OpsLoginPage />) })
    setInput('#ops-login-email', 'ops@example.com')
    setInput('#ops-login-password', 'wrongpass1')
    await submitForm()

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('メールアドレスかパスワードが違います')
  })

  it('429 のコードのみは混雑の待ち案内を出す', async () => {
    mockFetch(() => ({ status: 429, body: { success: false, error: 'rate_limited' } }))
    await act(async () => { root.render(<OpsLoginPage />) })
    setInput('#ops-login-email', 'ops@example.com')
    setInput('#ops-login-password', 'Passw0rd1')
    await submitForm()

    const alert = host.querySelector('[role="alert"]')?.textContent ?? ''
    expect(alert).not.toContain('rate_limited')
    expect(alert).toContain('少し待ってから')
  })
})
