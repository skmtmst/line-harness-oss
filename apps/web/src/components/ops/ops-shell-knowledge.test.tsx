// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OpsShell, { useOpsPageTitle } from './ops-shell'

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

function SupportTitle({ draft }: { draft: boolean }) {
  useOpsPageTitle(draft ? 'お問い合わせ ／ AIの下書き' : 'お問い合わせ')
  return <p>架空の下書き</p>
}

it('AI下書きの状態に合わせてトップバーだけを更新する', async () => {
  navigation.pathname = '/ops/support'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { platformAdmin: true } }) }))
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<OpsShell><SupportTitle draft /></OpsShell>))
    expect(host.querySelectorAll('h1')).toHaveLength(1)
    expect(host.querySelector('h1')?.textContent).toBe('お問い合わせ ／ AIの下書き')
    await act(async () => root.render(<OpsShell><SupportTitle draft={false} /></OpsShell>))
    expect(host.querySelector('h1')?.textContent).toBe('お問い合わせ')
  } finally { act(() => root.unmount()); host.remove() }
})

it.each(['/ops/knowledge', '/ops/support'])('%s のV6レイアウトでもメニューを開き、Escapeで閉じられる', async pathname => {
  navigation.pathname = pathname
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { platformAdmin: true } }) }))
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<OpsShell><p>ナレッジの本文</p></OpsShell>) })
    expect(host.querySelector('[data-knowledge-shell] > main > header h1')?.textContent).toBe(pathname === '/ops/knowledge' ? 'ナレッジ' : 'お問い合わせ')
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
