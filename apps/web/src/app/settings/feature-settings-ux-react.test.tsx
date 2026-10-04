// @vitest-environment happy-dom
/*
 * V8 サクサク感（設定）：
 * - 読み込み中はカードの形の骨組みが出て「読み込み中…」の文字は無い
 * - 保存ボタンは「保存中 → ✓ 保存しました」でボタンの中だけ変わる
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFeatureSettingsCache } from '@/lib/feature-settings-cache'

const fixture = vi.hoisted(() => ({
  accountId: 'account-a',
  hang: false,
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

function featureResponse() {
  return {
    success: true,
    data: {
      features: { scenarios: true, broadcasts: true, templates: true, forms: true },
      sidebarItemOrder: {}, specializedFeatureKeys: [], version: 3,
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.hang = false
  clearFeatureSettingsCache()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (fixture.hang) return new Promise<Response>(() => {})
    const path = String(input)
    if (path.includes('/api/settings/features/impact')) {
      return response({ success: true, data: { requiresConfirmation: false } })
    }
    if (path.includes('/api/settings/features') && (init?.method ?? 'GET') === 'GET') {
      return response(featureResponse())
    }
    if (path.includes('/api/settings/features') && init?.method === 'PUT') {
      return response({ success: true, data: featureResponse().data })
    }
    if (path.includes('/api/analytics/usage')) return response({ success: true, data: { categories: [] } })
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-theme')
})

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('V8 設定のサクサク感', () => {
  it('読み込み中は骨組みが出て「読み込み中」の文字は無い', async () => {
    document.documentElement.dataset.theme = 'v8'
    fixture.hang = true
    vi.useFakeTimers()
    try {
      await act(async () => {
        root.render(<SettingsPage />)
      })
      await act(async () => {
        vi.advanceTimersByTime(350)
      })
      expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
      expect(host.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
      expect(host.textContent).not.toContain('読み込み中')
    } finally {
      vi.useRealTimers()
    }
  })

  it('保存ボタンは保存後に「保存しました」になる', async () => {
    document.documentElement.dataset.theme = 'v8'
    await act(async () => {
      root.render(<SettingsPage />)
    })
    await flush()
    // スイッチを1つ切って未保存にする。
    const firstSwitch = host.querySelector('[role="switch"]') as HTMLElement
    expect(firstSwitch).not.toBeNull()
    await act(async () => { firstSwitch.click() })
    await flush()
    // 理由を書いて保存する。
    const reason = host.querySelector('#feature-settings-reason') as HTMLInputElement
    await act(async () => { setInputValue(reason, '使っていない機能を止めるため') })
    const saveButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('機能設定を保存'),
    ) as HTMLButtonElement
    await act(async () => { saveButton.click() })
    await flush()
    expect(host.textContent).toContain('保存しました')
  })
})
