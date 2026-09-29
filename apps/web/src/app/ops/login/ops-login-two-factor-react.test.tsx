// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsLoginPage from './page'

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'musubo' }) }))

let host: HTMLDivElement
let root: Root
let requestBody: Record<string, unknown> | null

beforeEach(() => {
  requestBody = null
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  window.history.replaceState(null, '', '/ops/login')
  window.sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      success: true,
      data: { twoFactor: false, twoFactorSetup: true, challengeToken: 'ops-setup-token' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

describe('運営ログインの二段階認証', () => {
  it.each([
    'line_token_failed',
    'line_id_token_missing',
    'line_verify_failed',
    'line_profile_missing',
    'line_login_failed',
  ])('%s は詳細を露出せず LINE ログインの共通案内を出す', async (errorCode) => {
    window.history.replaceState(null, '', `/ops/login?error=${errorCode}`)
    await act(async () => { root.render(<OpsLoginPage />) })

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'LINEログインを完了できませんでした。もう一度お試しください。',
    )
  })

  it('運営用途をWorkerへ渡し、未設定ならnext=opsを保って初回設定へ進む', async () => {
    await act(async () => { root.render(<OpsLoginPage />) })
    const email = host.querySelector('#ops-login-email') as HTMLInputElement
    const password = host.querySelector('#ops-login-password') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(email, 'ops@example.com'); email.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(password, 'Abcdefg1'); password.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(requestBody).toMatchObject({ email: 'ops@example.com', password: 'Abcdefg1', next: 'ops' })
    expect(window.location.pathname).toBe('/login/two-factor/setup')
    expect(window.location.search).toBe('?next=ops')
    expect(new URLSearchParams(window.location.hash.slice(1)).get('lh_2fa')).toBe('ops-setup-token')
  })
})
