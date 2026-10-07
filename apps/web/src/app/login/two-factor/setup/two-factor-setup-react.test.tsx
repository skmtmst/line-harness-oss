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
  confirmStatus: 200,
  confirmReject: null as unknown,
  setupStatus: 200,
  setupReject: null as unknown,
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
}))

vi.mock('next/link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a href={props.href}>{props.children}</a>,
}))
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
  fixture.confirmStatus = 200
  fixture.confirmReject = null
  fixture.setupStatus = 200
  fixture.setupReject = null
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  window.sessionStorage.clear()
  window.localStorage?.clear?.()
  window.location.hash = fixture.hash
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (init?.body) fixture.calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
    if (url.endsWith('/api/auth/two-factor/setup/confirm')) {
      if (fixture.confirmReject) throw fixture.confirmReject
      return json(fixture.confirmResponse, fixture.confirmStatus)
    }
    if (url.endsWith('/api/auth/two-factor/setup')) {
      if (fixture.setupReject) throw fixture.setupReject
      return json(fixture.setupResponse, fixture.setupStatus)
    }
    if (url.endsWith('/api/auth/session')) return json({ success: true, data: { platformAdmin: true } })
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
    // 6桁目が入った瞬間に送られる（動きの点検・6）。返事を待つだけ。
    await flush()
    expect(fixture.calls.at(-1)).toMatchObject({
      url: 'https://api.example.test/api/auth/two-factor/setup/confirm',
      body: { challengeToken: 'setup-tok-1', code: '123456' },
    })
    expect(window.sessionStorage.getItem('lh_admin_session_fallback')).toBe('sess-1')
    expect(window.location.pathname).toBe('/')
  })

  it('運営ログインからの初回設定はsessionと運営権限を確認して /ops へ進む', async () => {
    window.history.replaceState(null, '', `/login/two-factor/setup?next=ops${fixture.hash}`)
    await render()
    const input = host.querySelector('#totp-setup-code') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '123456')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 6桁目が入った瞬間に送られる（動きの点検・6）。返事を待つだけ。
    await flush()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/session',
      expect.objectContaining({ headers: { Authorization: 'Bearer lh_session:sess-1' } }),
    )
    expect(window.location.pathname).toBe('/ops')
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
    // 6桁目が入った瞬間に送られる（動きの点検・6）。返事を待つだけ。
    await flush()
    expect(host.textContent).toContain('コードが違います。もう一度入れてください')
    expect(input.value).toBe('')
    expect(window.sessionStorage.getItem('lh_admin_session_fallback')).toBeNull()
  })

  it('R508: 確認で期限切れ401なら入力を終わらせてログインへ戻る導線を出す', async () => {
    fixture.confirmResponse = { success: false, error: '設定の有効時間が切れました。ログインからやり直してください' }
    fixture.confirmStatus = 401
    await render()
    expect(host.querySelector('form')).not.toBeNull()
    const input = host.querySelector('#totp-setup-code') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '654321')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 6桁目が入った瞬間に送られる（動きの点検・6）。返事を待つだけ。
    await flush()
    expect(host.textContent).toContain('設定の有効時間が切れました')
    // 無効なQRと入力欄は再試行可能に見せない。
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    const loginLink = host.querySelector('a[href="/login"]')
    expect(loginLink).not.toBeNull()
    expect(loginLink?.textContent).toContain('ログイン')
  })

  it('R508: 確認で回数制限429なら入力を終わらせてログインへ戻る導線を出す', async () => {
    fixture.confirmResponse = { success: false, error: '入力回数を超えました。ログインからやり直してください' }
    fixture.confirmStatus = 429
    await render()
    const input = host.querySelector('#totp-setup-code') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '654321')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 6桁目が入った瞬間に送られる（動きの点検・6）。返事を待つだけ。
    await flush()
    expect(host.textContent).toContain('入力回数を超えました')
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('a[href="/login"]')).not.toBeNull()
  })

  it('R506のついで: 確認の通信断は日本語の案内にし、入力欄は残す', async () => {
    fixture.confirmReject = new TypeError('Failed to fetch')
    await render()
    const input = host.querySelector('#totp-setup-code') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '654321')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 6桁目が入った瞬間に送られる（動きの点検・6）。返事を待つだけ。
    await flush()
    expect(host.textContent).toContain('接続を確かめて')
    expect(host.textContent).not.toContain('Failed to fetch')
    // 通信断では合言葉は生きているので、入力欄を残して再試行できる。
    expect(host.querySelector('form')).not.toBeNull()
  })

  it('M033: setup開始の失敗はその場で再試行できる（再ログイン不要）', async () => {
    fixture.setupResponse = { success: false, error: '一時的に混み合っています' }
    fixture.setupStatus = 500
    await render()
    expect(host.querySelector('form')).toBeNull()
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()
    fixture.setupResponse = {
      success: true,
      data: {
        provisioningUri: 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=x',
        manualKey: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
      },
    }
    fixture.setupStatus = 200
    await act(async () => { retry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(fixture.calls.filter((c) => c.url.endsWith('/api/auth/two-factor/setup')).length).toBe(2)
    expect(host.querySelector('form')).not.toBeNull()
    expect(host.textContent).toContain('GEZD GNBV GY3T QOJQ')
  })

  it('M033: setup開始の通信断もその場で再試行できる', async () => {
    fixture.setupReject = new TypeError('Failed to fetch')
    await render()
    expect(host.textContent).not.toContain('Failed to fetch')
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()
  })

  it('M033: setup開始の403は再試行を出さない', async () => {
    fixture.setupResponse = { success: false, error: '権限がありません' }
    fixture.setupStatus = 403
    await render()
    expect(host.textContent).toContain('権限がありません')
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeUndefined()
  })

  it('M033: setup開始の429は待ち案内と再試行を出す', async () => {
    fixture.setupResponse = { success: false, error: '混み合っています' }
    fixture.setupStatus = 429
    await render()
    expect(host.textContent).toContain('混み合っています')
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()
  })
})
