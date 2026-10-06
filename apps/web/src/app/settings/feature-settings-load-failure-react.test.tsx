// @vitest-environment happy-dom
/*
 * D019: 機能設定の読み込みに失敗したら、初期値のスイッチ一覧を
 * 本物の設定のように出さない。理由と再読み込みだけを出す。
 * - 403 … 見る権限がない旨＋再読み込み（偽のスイッチなし）
 * - 通信断 … 読み込めない旨＋再読み込み（偽のスイッチなし）
 * - 再読み込みで直ればスイッチが出る
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFeatureSettingsCache } from '@/lib/feature-settings-cache'

const fixture = vi.hoisted(() => ({
  accountId: 'account-a',
  mode: 'ok' as 'ok' | 'forbidden' | 'down',
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

const { default: SettingsPage } = await import('./page')

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root
let mounted = false

function featureResponse() {
  return {
    success: true,
    data: {
      features: { scenarios: true, broadcasts: true, templates: true, forms: true },
      sidebarItemOrder: {}, specializedFeatureKeys: [], version: 3,
    },
  }
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.mode = 'ok'
  // V8だけ見る（v7側は触らない）。SettingsPage はこの印でV8を出す。
  document.documentElement.dataset.theme = 'v8'
  clearFeatureSettingsCache()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    if (path.includes('/api/settings/features') && (init?.method ?? 'GET') === 'GET') {
      if (fixture.mode === 'forbidden') return response({ success: false, error: 'forbidden' }, 403)
      if (fixture.mode === 'down') throw new TypeError('Failed to fetch')
      return response(featureResponse())
    }
    if (path.includes('/api/analytics/usage')) return response({ success: true, data: { categories: [] } })
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderPage() {
  await act(async () => {
    root.render(<SettingsPage />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

function switches(): number {
  return host.querySelectorAll('[role="switch"]').length
}

function retryButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'もう一度試す') as HTMLButtonElement | undefined
}

describe('D019 機能設定の読み込み失敗', () => {
  it('権限なし（403）では偽のスイッチを出さず理由と再読み込みを出す', async () => {
    fixture.mode = 'forbidden'
    await renderPage()
    await settle()
    expect(document.body.textContent).toContain('機能設定を見る権限がありません')
    expect(retryButton()).toBeTruthy()
    expect(switches()).toBe(0)
  })

  it('通信断では偽のスイッチを出さず理由と再読み込みを出す', async () => {
    fixture.mode = 'down'
    await renderPage()
    await settle()
    expect(document.body.textContent).toContain('設定を読み込めませんでした')
    expect(retryButton()).toBeTruthy()
    expect(switches()).toBe(0)
  })

  it('再読み込みで直ればスイッチが出る', async () => {
    fixture.mode = 'down'
    await renderPage()
    await settle()
    expect(switches()).toBe(0)
    fixture.mode = 'ok'
    const retry = retryButton()
    if (!retry) throw new Error('再読み込みのボタンがありません')
    await act(async () => { retry.click(); await Promise.resolve() })
    await settle()
    await settle()
    expect(switches()).toBeGreaterThan(0)
  })
})
