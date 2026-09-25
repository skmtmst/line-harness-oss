// @vitest-environment happy-dom
/*
 * PERF-07: AuthGuard のセッション確認は、直前の確認を短時間再利用する。
 *
 * 以前は画面遷移（pathname 変更）のたびに /api/auth/session へ往復していた。
 * 管理画面と API は別サイトなので、この往復は遅い。
 *
 * 再利用してよいのは「同じログインの確認が取れている直後」だけ。
 * トークン/CSRF の指紋が変わる、401 の合図が届く、期限が切れる、
 * のどれかなら必ず確認し直す（権限変更やログアウトを取りこぼさないため）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentPath = '/'
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => currentPath,
}))

vi.mock('./hq/platform-notices', () => ({
  default: () => <div data-platform-notices>運営からのお知らせ</div>,
}))

import AuthGuard, { invalidateAuthSessionCheck } from './auth-guard'
import { SESSION_LOST_EVENT } from '@/lib/api'

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

let host: HTMLDivElement
let root: Root
let fetchSpy: ReturnType<typeof vi.fn>
let storage: MemoryStorage

function sessionOk(tenantStatus: 'active' | 'suspended' | 'archived' = 'active') {
  return new Response(
    JSON.stringify({
      success: true,
      data: { name: 'テスト担当', role: 'admin', tenantStatus, permissionKeys: [], viewPermissionKeys: [] },
      csrfToken: 'csrf-token-1',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

async function render() {
  await act(async () => {
    root.render(<AuthGuard><div data-child>中身</div></AuthGuard>)
  })
}

describe('PERF-07 AuthGuard のセッション確認再利用', () => {
  beforeEach(() => {
    currentPath = '/'
    replaceMock.mockReset()
    invalidateAuthSessionCheck()
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    fetchSpy = vi.fn(async () => sessionOk())
    vi.stubGlobal('fetch', fetchSpy)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('初回は /api/auth/session を確認して中身を出す', async () => {
    await render()
    await settle()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/api/auth/session')
    expect(host.querySelector('[data-child]')).not.toBeNull()
  })

  it('直後の画面遷移では再確認しない', async () => {
    await render()
    await settle()

    currentPath = '/friends'
    await act(async () => { root.render(<AuthGuard><div data-child>中身</div></AuthGuard>) })
    await settle()

    currentPath = '/templates'
    await act(async () => { root.render(<AuthGuard><div data-child>中身</div></AuthGuard>) })
    await settle()

    // 30秒以内の遷移なら確認は初回の1回だけ。
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-child]')).not.toBeNull()
  })

  it('期限（30秒）を過ぎた遷移では確認し直す', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000
    nowSpy.mockImplementation(() => now)

    await render()
    await settle()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 31_000
    currentPath = '/friends'
    await act(async () => { root.render(<AuthGuard><div data-child>中身</div></AuthGuard>) })
    await settle()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('CSRFトークンが変わった（別ログイン/権限更新）なら期限前でも確認し直す', async () => {
    await render()
    await settle()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    storage.setItem('lh_csrf', 'csrf-token-2')
    currentPath = '/friends'
    await act(async () => { root.render(<AuthGuard><div data-child>中身</div></AuthGuard>) })
    await settle()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('401の合図（SESSION_LOST_EVENT）のあとは期限前でも確認し直す', async () => {
    await render()
    await settle()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    act(() => { window.dispatchEvent(new Event(SESSION_LOST_EVENT)) })

    currentPath = '/friends'
    await act(async () => { root.render(<AuthGuard><div data-child>中身</div></AuthGuard>) })
    await settle()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('確認に失敗したら再利用せずログイン画面へ送る', async () => {
    fetchSpy.mockImplementation(async () => new Response(null, { status: 401 }))

    await render()
    await settle()

    expect(replaceMock).toHaveBeenCalledWith('/login')
    expect(host.querySelector('[data-child]')).toBeNull()
  })

  it.each(['suspended', 'archived'] as const)('%s の通常画面をV6の停止案内に差し替える', async (status) => {
    fetchSpy.mockImplementation(async () => sessionOk(status))
    currentPath = '/friends'
    await render()
    await settle()

    expect(host.querySelector('[data-child]')).toBeNull()
    expect(host.querySelector('[data-design-node="CXFjb9"]')).not.toBeNull()
    expect(host.textContent).toContain('現在ご利用いただけません')
    expect(host.querySelector('[data-platform-notices]')).not.toBeNull()
  })

  it('停止中でも /hq/support は通常画面へ到達できる', async () => {
    fetchSpy.mockImplementation(async () => sessionOk('suspended'))
    currentPath = '/hq/support'
    await render()
    await settle()

    expect(host.querySelector('[data-child]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="CXFjb9"]')).toBeNull()
  })
})
