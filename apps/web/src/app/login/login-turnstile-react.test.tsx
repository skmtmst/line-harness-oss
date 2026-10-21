// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './page'
import OpsLogin from '@/v8/ops/login'

const fixture = vi.hoisted(() => ({
  siteKey: 'fixture-public-site-key' as string | null,
  request: vi.fn(),
}))
vi.mock('@/lib/auth-email', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth-email')>(),
  get TURNSTILE_SITE_KEY() { return fixture.siteKey },
  authRequest: fixture.request,
}))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock() }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'musubo' }) }))

let host: HTMLDivElement
let root: Root
let widgetOptions: Record<string, unknown>
let reset: ReturnType<typeof vi.fn>

beforeEach(() => {
  fixture.siteKey = 'fixture-public-site-key'
  fixture.request.mockReset().mockResolvedValue({ ok: false, status: 401, error: 'メールアドレスまたはパスワードが正しくありません' })
  widgetOptions = {}
  reset = vi.fn()
  window.turnstile = {
    render: vi.fn((_host, options) => { widgetOptions = options; return 'widget-qa' }),
    reset,
    remove: vi.fn(),
  }
  window.history.replaceState(null, '', '/login')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete window.turnstile
})

async function fill(selector: string, value: string) {
  await act(async () => {
    const input = host.querySelector(selector) as HTMLInputElement
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}
async function widgetEvent(name: string, token?: string) {
  await act(async () => { (widgetOptions[name] as (token?: string) => void)(token) })
}

describe.each([
  ['管理画面', LoginPage, '#login', false],
  ['運営コンソール', OpsLogin, '#ops-login', true],
] as const)('%s のロボット確認とログイン', (_name, Page, prefix, ops) => {
  async function render() {
    await act(async () => { root.render(<Page />) })
    await fill(`${prefix}-email`, 'qa@example.invalid')
    await fill(`${prefix}-password`, 'QaPlaceholder123')
  }

  it('未確認では認証APIを呼ばず、確認後にトークンとログイン経路を送る', async () => {
    await render()
    expect(host.querySelector('[aria-label="ロボットでないことの確認"]')).not.toBeNull()
    await submit()
    expect(fixture.request).not.toHaveBeenCalled()
    expect(host.textContent).toContain('確認を済ませてください')

    await widgetEvent('callback', 'single-use-token-1')
    await submit()
    expect(fixture.request).toHaveBeenCalledWith('/api/auth/password/login', {
      email: 'qa@example.invalid', password: 'QaPlaceholder123', turnstileToken: 'single-use-token-1',
      ...(ops ? { next: 'ops' } : { remember: false }),
    })
  })

  it.each(['expired-callback', 'error-callback'])('%s 後は新しい確認が必要', async (event) => {
    await render()
    await widgetEvent('callback', 'expired-token')
    await widgetEvent(event)
    await submit()
    expect(fixture.request).not.toHaveBeenCalled()
    expect(host.textContent).toContain('確認を済ませてください')
  })

  it('認証失敗後は使い切りの確認をリセットし、新しいトークンでやり直す', async () => {
    await render()
    await widgetEvent('callback', 'single-use-token-1')
    await submit()
    expect(reset).toHaveBeenCalledWith('widget-qa')
    expect(host.textContent).toContain('メールアドレスまたはパスワードが正しくありません')
    await submit()
    expect(fixture.request).toHaveBeenCalledTimes(1)
    await widgetEvent('callback', 'single-use-token-2')
    await submit()
    expect(fixture.request).toHaveBeenCalledTimes(2)
    expect(fixture.request.mock.calls[1][1].turnstileToken).toBe('single-use-token-2')
  })

  it('サイト用の鍵が無い環境では理由を出し、メールログインを押せない', async () => {
    fixture.siteKey = null
    await render()
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('ロボット対策の設定が済んでいないため')
    await submit()
    expect(fixture.request).not.toHaveBeenCalled()
  })
})
