// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsTwoFactorPage from './page'

vi.mock('next/link', () => ({ default: () => null }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Node の experimental localStorage は実体が無いので、happy-dom でも自前で立てる。 */
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

/**
 * #1058: 2要素認証の確認。
 * `fetchApi` は 4xx/5xx を例外で投げる。`await api.staff.confirmTwoFactorSetup` を
 * そのまま書くと例外で `setBusy(false)` が走らず「確認しています…」のまま
 * ボタンが固まるので、`opsCall` で受けてエラーを画面へ出す契約。
 */

let host: HTMLDivElement
let root: Root
let confirmStatus: number
let confirmBody: Record<string, unknown>

beforeEach(() => {
  confirmStatus = 400
  confirmBody = { error: '認証コードが正しくありません' }
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
    if (url.includes('/two-factor/confirm')) {
      return new Response(JSON.stringify(confirmBody), { status: confirmStatus, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: true, data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

async function renderReady() {
  await act(async () => { root.render(<OpsTwoFactorPage />) })
  await flush()
  const field = host.querySelector('#ops-totp-code') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(field, '123456')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
  await flush()
}

const submitButton = () =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('登録を完了') || b.textContent?.includes('確認しています'))

describe('2要素認証の確認エラー', () => {
  it('400 が返ってもボタンを戻し、サーバーの文言をそのまま出す', async () => {
    await renderReady()
    await submit()

    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('認証コードが正しくありません')
    // 「確認しています…」のまま固まらず、もう一度押せる。
    const button = submitButton()
    expect(button?.textContent).toContain('確認して登録を完了する')
    expect(button?.disabled).toBe(false)
  })

  it('5xx が返ってもボタンを戻し、状態コードから言い換えた案内を出す', async () => {
    confirmStatus = 500
    confirmBody = { error: 'internal' }
    await renderReady()
    await submit()

    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('サーバーでエラーが起きました')
    const button = submitButton()
    expect(button?.textContent).toContain('確認して登録を完了する')
    expect(button?.disabled).toBe(false)
  })

  it('200 でも success:false なら従来どおり文言を出す', async () => {
    confirmStatus = 200
    confirmBody = { success: false, error: 'コードの有効期限が切れています' }
    await renderReady()
    await submit()

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('コードの有効期限が切れています')
    expect(submitButton()?.disabled).toBe(false)
  })

  it('確認が通ると完了の案内へ進む', async () => {
    confirmStatus = 200
    confirmBody = { success: true, data: { id: 's1' } }
    await renderReady()
    await submit()

    expect(host.textContent).toContain('2要素認証を登録しました')
  })
})
