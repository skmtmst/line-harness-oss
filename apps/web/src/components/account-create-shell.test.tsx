import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import AppShell from './app-shell'

const route = vi.hoisted(() => ({ pathname: '/accounts/new' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
vi.mock('./layout/sidebar', () => ({ default: () => <aside data-test="sidebar" /> }))
vi.mock('./shell/app-top-bar', () => ({ default: () => <header data-test="topbar" /> }))
vi.mock('./update/update-banner', () => ({ UpdateBanner: () => null }))
vi.mock('./session-lost-notice', () => ({ default: () => <div data-test="session" /> }))
vi.mock('./auth-guard', () => ({ default: ({ children }: { children: ReactNode }) => <div data-test="auth">{children}</div> }))
vi.mock('@/contexts/account-context', () => ({ AccountProvider: ({ children }: { children: ReactNode }) => <div data-test="account">{children}</div> }))
vi.mock('./root-landing-gate', () => ({ default: ({ children }: { children: ReactNode }) => <div data-test="root">{children}</div> }))
vi.mock('./store-selection-gate', () => ({ default: ({ children }: { children: ReactNode }) => <div data-test="store">{children}</div> }))
vi.mock('./feature-disabled-gate', () => ({ default: ({ children }: { children: ReactNode }) => <div data-test="feature">{children}</div> }))

describe('登録専用の画面枠', () => {
  it.each(['/accounts/new', '/accounts', '/hq', '/accounts/new-other'])('認証と全gateを保持: %s', pathname => {
    route.pathname = pathname
    const html = renderToStaticMarkup(<AppShell><p>登録内容</p></AppShell>)
    expect(html).toContain('<div data-test="auth"><div data-test="account">')
    expect(html).toContain('<div data-test="root"><div data-test="store"><div data-test="feature"><p>登録内容</p>')
    expect(html).toContain('data-test="session"')
    expect(html.includes('data-test="sidebar"')).toBe(pathname !== '/accounts/new')
    expect(html.includes('data-test="topbar"')).toBe(pathname !== '/accounts/new')
  })
})
