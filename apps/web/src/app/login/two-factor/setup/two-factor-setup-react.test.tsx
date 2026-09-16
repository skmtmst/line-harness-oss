// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwoFactorSetupPage from './page'

/*
 * N-426: 二段階認証の初回設定画面の対照。
 *   - 合言葉（#lh_2fa=）で /api/auth/two-factor/setup を呼びQRと手動キーを出す
 *   - 6桁の確認が通ると /api/auth/two-factor/setup/confirm でセッションを受け取り管理画面へ
 *   - 合言葉が無い・切れているときはログインへ戻る導線だけ出す（詰ませない）
 */

const fixture = vi.hoisted(() => ({
  hash: '#lh_2fa=setup-tok-1',
  setupResponse: {
    success: true,
    data: {
      provisioningUri: 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=x',
      manualKey: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
    },
  } as Record<string, unknown>,
  confirmResponse: { success: true, data: { sessionToken: 'sess-1' }, csrfToken: 'csrf-1' } as Record<string, unknown>,
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/login/two-factor/setup',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'テスト統括' }) }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,qr') } }))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root

function flush(): Promise<void> {
  return act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  fixture.hash = '#lh_2fa=setup-tok-1'
  fixture.calls = []
  fixture.setupResponse = {
    success: true,
    data: {
      provisioningUri: 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=x',
      manualKey: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
    },
  }
  fixture.confirmResponse = { success: true, data: { sessionToken: 'sess-1' }, csrfToken: 'csrf-1' }
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  window.sessionStorage.clear()
  window.localStorage?.clear?.()
  window.location.hash = fixture.hash
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (init?.body) fixture.calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
    if (url.endsWith('/api/auth/two-factor/setup/confirm')) return json(fixture.confirmResponse)
    if (url.endsWith('/api/auth/two-factor/setup')) return json(fixture.setupResponse)
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
  await act(async () => { root.render(<TwoFactorSetupPage />) })
  await flush()
}

describe('N-426: 初回設定画面', () => {
  it('合言葉で setup を呼び、QR と手動キーと6桁の入力欄を出す', async () => {
    await render()
    expect(fixture.calls[0]).toMatchObject({
      url: 'https://api.example.test/api/auth/two-factor/setup',
      body: { challengeToken: 'setup-tok-1' },
    })
    expect(host.textContent).toContain('二段階認証を設定')
    expect(host.querySelector('img')).toBeTruthy()
    expect(host.textContent).toContain('GEZD GNBV GY3T QOJQ')
    expect(host.querySelector('#totp-setup-code')).toBeTruthy()
  })

  it('6桁を入れて confirm するとセッションを受け取り / へ進む', async () => {
    await render()
    const input = host.querySelector('#totp-setup-code') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '123456')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = host.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(fixture.calls.at(-1)).toMatchObject({
      url: 'https://api.example.test/api/auth/two-factor/setup/confirm',
      body: { challengeToken: 'setup-tok-1', code: '123456' },
    })
    expect(window.sessionStorage.getItem('lh_admin_session_fallback')).toBe('sess-1')
    expect(window.location.pathname).toBe('/')
  })

  it('合言葉が無いときは setup を呼ばず、ログインへ戻る導線を出す', async () => {
    fixture.hash = ''
    window.location.hash = ''
    await render()
    expect(fixture.calls).toEqual([])
    expect(host.textContent).toContain('合言葉がありません')
  })

  it('confirm が拒否されたらエラーを出して入力を戻す', async () => {
    fixture.confirmResponse = { success: false, error: '認証コードが正しくありません' }
    await render()
    const input = host.querySelector('#totp-setup-code') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '654321')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = host.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(host.textContent).toContain('認証コードが正しくありません')
    expect(input.value).toBe('')
    expect(window.sessionStorage.getItem('lh_admin_session_fallback')).toBeNull()
  })
})
