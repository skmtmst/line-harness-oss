// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OpsShell from './ops-shell'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/navigation', () => {
  const router = { replace: vi.fn() }
  return { usePathname: () => '/ops/knowledge', useRouter: () => router }
})
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/api', () => ({ api: { ops: { me: async () => ({ success: true, data: { name: '架空運営者', email: null, totpEnabled: true, impersonation: null } }) } } }))
vi.mock('@/lib/admin-session', () => ({ adminSessionHeaders: () => ({}), captureAdminSessionHandoff: () => null }))

afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow = '' })

it('ナレッジ専用レイアウトでもメニューを開き、Escapeで閉じられる', async () => {
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
    expect(host.querySelector('aside')?.className).toMatch(/^flex /)
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(open.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('aside')?.className).toMatch(/^hidden /)
    expect(document.body.style.overflow).toBe('')
  } finally { act(() => root.unmount()); host.remove() }
})
