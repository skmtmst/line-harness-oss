// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import OpsShell from './ops-shell'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/navigation', () => {
  const router = { replace: vi.fn() }
  return { usePathname: () => navigation.pathname, useRouter: () => router }
})
const navigation = vi.hoisted(() => ({ pathname: '/ops/knowledge' }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/api', () => ({ api: { ops: { me: async () => ({ success: true, data: { name: '架空運営者', email: null, totpEnabled: true, impersonation: null } }) } } }))
vi.mock('@/lib/admin-session', () => ({ adminSessionHeaders: () => ({}), captureAdminSessionHandoff: () => null }))

afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow = '' })

/*
 * ★管理画面: 外枠は全画面で同じ形。ナレッジ・お問い合わせだけの帯
 * （運営 TopBar・data-knowledge-shell）は出さない。画面名は各画面の
 * OpsPageHeader が出す。開閉メニューの振る舞いは変えない。
 */
it.each(['/ops/knowledge', '/ops/support', '/ops/tenants'])('%s はほかの画面と同じ外枠で、運営の帯を出さない', async pathname => {
  navigation.pathname = pathname
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { platformAdmin: true } }) }))
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<OpsShell><p>本文</p></OpsShell>) })
    expect(host.querySelector('[data-knowledge-shell]')).toBeNull()
    // 帯ではなく各画面の見出しだけ。外枠自体は見出しを持たない。
    expect(host.textContent).toContain('本文')
  } finally { act(() => root.unmount()); host.remove() }
})

it.each(['/ops/knowledge', '/ops/support'])('%s でもメニューを開き、Escapeで閉じられる', async pathname => {
  navigation.pathname = pathname
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { platformAdmin: true } }) }))
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<OpsShell><p>ナレッジの本文</p></OpsShell>) })
    const open = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'メニュー')!
    expect(open).toBeDefined()
    expect(open.getAttribute('aria-expanded')).toBe('false')
    await act(async () => open.click())
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('aside[aria-label="運営メニュー（開いた形）"]')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(open.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('aside[aria-label="運営メニュー（開いた形）"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    const self = host.querySelector('button[aria-label="自分のメニュー"]') as HTMLButtonElement
    await act(async () => self.click())
    await waitFor(() => expect(document.querySelector('[role="menuitem"][href="/staff"]')).not.toBeNull())
    const profile = document.querySelector('[role="menuitem"][href="/staff"]') as HTMLAnchorElement
    expect(profile.textContent).toBe('プロフィールを編集')
    profile.focus()
    fireEvent.keyDown(profile, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('href')).toBe('/ops/members')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('href')).toBe('/ops/two-factor')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(self.getAttribute('aria-expanded')).toBe('false'))
  } finally { act(() => root.unmount()); host.remove() }
})
