// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 1152 幅の板の印（V8.pen の地図）。板が 1100px を切ったら（画面幅で約 1352px
 * 未満）、作る画面の外枠に板 `a1k3d` を付ける。広い板では `u5YC6` のまま。
 */

let narrowMatches = false
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/templates/edit',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [], selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/staff-capability', () => ({
  isOwnerOrAdmin: () => true,
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))

import TemplateEditV8 from './edit-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: narrowMatches && query.includes('1351'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    configurable: true,
  })
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    let body: unknown = { success: true, data: {} }
    if (path.startsWith('/api/folders')) body = { success: true, data: [] }
    if (path.startsWith('/api/templates/references')) body = { success: true, data: { scenarios: [], autoReplies: [], reminders: [] } }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

beforeEach(() => {
  narrowMatches = false
  document.documentElement.dataset.theme = 'v8'
  installMatchMedia()
  installFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

describe('テンプレート作る画面の1152幅の印', () => {
  it('狭い板では外枠に a1k3d', async () => {
    narrowMatches = true
    render(<TemplateEditV8 />)
    await eventually(() => {
      const page = document.body.querySelector('[data-design-node="a1k3d"]')
      if (!page) throw new Error('a1k3d not attached')
    })
  })

  it('広い板では u5YC6 のまま', async () => {
    narrowMatches = false
    render(<TemplateEditV8 />)
    await eventually(() => {
      const page = document.body.querySelector('[data-design-node="u5YC6"]')
      if (!page) throw new Error('u5YC6 not attached')
    })
  })
})
