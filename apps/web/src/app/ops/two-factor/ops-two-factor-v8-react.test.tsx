// @vitest-environment happy-dom
/*
 * 運営2要素認証の設定 V8（板 qod6X）。
 * 6桁が揃うまで「登録する」を押せなくする。QRの再表示と
 * 手入力キー・登録後のログアウト案内はそのまま。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsTwoFactorPage from './page'

vi.mock('next/link', () => ({ default: () => null }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  window.history.replaceState(null, '', '/ops/two-factor')
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/session')) {
      return new Response(JSON.stringify({
        success: true,
        data: { id: 's1', name: '運営 太郎', platformAdmin: true },
        csrfToken: 'csrf-token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/two-factor/setup')) {
      return new Response(JSON.stringify({
        success: true,
        data: { provisioningUri: 'otpauth://totp/musubo?secret=ABC123', manualKey: 'ABC123' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: true, data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

function typeCode(value: string) {
  const field = host.querySelector('#ops-totp-code') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  return act(async () => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const registerButton = () =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('登録する'))

describe('2要素認証の設定V8（qod6X）', () => {
  it('板IDを持ち、6桁が揃うまで登録させない', async () => {
    await act(async () => { root.render(<OpsTwoFactorPage />) })
    await flush()
    expect(host.querySelector('[data-design-node="qod6X"]')).not.toBeNull()
    expect(registerButton()?.textContent).toContain('登録する')
    // 空のままは押せない
    expect(registerButton()?.disabled).toBe(true)
    await typeCode('12345')
    expect(registerButton()?.disabled).toBe(true)
    // 6桁目が入った瞬間に、押さなくても確かめを送る（動きの点検・6）。
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const before = fetchMock.mock.calls.length
    await typeCode('123456')
    await flush()
    expect(fetchMock.mock.calls.slice(before).some(([url]) => String(url).includes('confirm'))).toBe(true)
  })

  it('QRの再表示と手入力キー・登録後の案内を出す', async () => {
    await act(async () => { root.render(<OpsTwoFactorPage />) })
    await flush()
    expect(host.textContent).toContain('QRをもう一度表示する')
    expect(host.textContent).toContain('読み取れないときは、このキーを手で入力')
    expect(host.textContent).toContain('一度ログアウト')
  })
})
