// @vitest-environment happy-dom
/*
 * V6R-S0-a: 代理ログイン帯は AuthGuard が取ったセッションの答えを読む。
 *
 * 検証環境の実測では、どの画面でも /api/auth/session が2回、直列に呼ばれていた
 * （1回目 AuthGuard、2回目この帯）。帯は AuthGuard の内側に載るので、2回目は要らない。
 * 手元に答えが無いとき（AuthGuard を通らずに帯だけが載ったとき）だけ、帯が自分で取る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))

import AuthGuard, { invalidateAuthSessionCheck } from '../auth-guard'
import ImpersonationNotice from './impersonation-notice'
import { readSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'

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

const impersonating = {
  tenantId: 'tenant-1', mode: 'read', startedAt: '2026-09-23T00:00:00Z', piiRevealed: false,
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

let host: HTMLDivElement
let root: Root
let fetchSpy: ReturnType<typeof vi.fn>
let sessionImpersonation: typeof impersonating | null

function calls(path: string) {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes(path)).length
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

describe('代理ログイン帯はセッションを取り直さない（V6R-S0-a）', () => {
  beforeEach(() => {
    invalidateAuthSessionCheck()
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    sessionImpersonation = null
    fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes('/api/auth/session')) {
        return json({
          success: true,
          data: { name: '運営', role: 'owner', permissionKeys: [], viewPermissionKeys: [], impersonation: sessionImpersonation },
          csrfToken: 'csrf-1',
        })
      }
      if (String(url).includes('/api/tenants/me')) return json({ success: true, data: { name: '契約先A' } })
      return json({ success: true, data: null })
    })
    vi.stubGlobal('fetch', fetchSpy)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('代理ログインでないとき、/api/auth/session は AuthGuard の1回だけ', async () => {
    await act(async () => { root.render(<AuthGuard><ImpersonationNotice /></AuthGuard>) })
    await settle()

    expect(calls('/api/auth/session')).toBe(1)
    expect(calls('/api/tenants/me')).toBe(0)
    expect(host.textContent).not.toContain('閲覧中')
  })

  it('代理ログイン中も /api/auth/session は1回で、帯は出る', async () => {
    sessionImpersonation = impersonating
    await act(async () => { root.render(<AuthGuard><ImpersonationNotice /></AuthGuard>) })
    await settle()

    expect(calls('/api/auth/session')).toBe(1)
    expect(calls('/api/tenants/me')).toBe(1)
    expect(host.textContent).toContain('契約先A')
  })

  it('AuthGuard の答えが手元に無いときは、帯が自分で取りに行く', async () => {
    sessionImpersonation = impersonating
    await act(async () => { root.render(<ImpersonationNotice />) })
    await settle()

    expect(calls('/api/auth/session')).toBe(1)
    expect(host.textContent).toContain('契約先A')
  })

  it('代理ログインを終えたら、共有した答え（代理ログイン中）を捨てる', async () => {
    rememberSessionSnapshot({ impersonation: impersonating as never })
    await act(async () => { root.render(<ImpersonationNotice />) })
    await settle()
    expect(readSessionSnapshot()).not.toBeNull()

    const endButton = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('代理ログインを終える'))
    await act(async () => { endButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await settle()

    expect(readSessionSnapshot()).toBeNull()
  })
})
