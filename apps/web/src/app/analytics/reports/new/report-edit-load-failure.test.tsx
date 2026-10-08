// @vitest-environment happy-dom
/*
 * 監査 WEB308：なおす対象の定期レポートを履歴の口で引けなかったとき、
 * 通信の失敗を「見つかりませんでした」と言わず、読み直せる失敗として出す。
 * 本当に無い（404）ときは今までどおり「見つかりませんでした」。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, settle, type Mounted } from '@/test-utils/race'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'report-x' : null) }),
  usePathname: () => '/analytics/reports/new',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageChrome: () => ({ title: null, fullWidth: false }),
}))

const net = vi.hoisted(() => ({ runsStatus: 503 }))
const OPTIONS = {
  timeZone: 'Asia/Tokyo', savedAnalyses: [],
  recipients: [{ id: 'u-1', name: '担当1', role: 'owner', email: 'u1@example.com', lineLinked: true }],
}

const { default: Page } = await import('./page')

let view: Mounted
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = new URL(String(input), 'https://worker.example.com')
    if (url.pathname === '/api/staff/me') return new Response(JSON.stringify({ success: true, data: { role: 'owner' } }))
    if (url.pathname.endsWith('/runs')) {
      return new Response(JSON.stringify({ success: false, error: 'x' }), { status: net.runsStatus })
    }
    if (url.pathname === '/api/analytics/report-schedules') {
      return new Response(JSON.stringify({ success: true, data: { items: [], options: OPTIONS } }))
    }
    return new Response(JSON.stringify({ success: false, error: 'not found' }), { status: 404 })
  })
  view = mount()
})
afterEach(async () => {
  await view.unmount()
  vi.unstubAllGlobals()
})

describe('なおす対象の読み込み失敗（WEB308）', () => {
  it('通信の失敗は「見つかりませんでした」にせず、読み直しを出す', async () => {
    net.runsStatus = 503
    await view.render(<Page />)
    await settle()
    expect(view.host.textContent).toContain('定期レポートを表示できませんでした')
    expect(view.host.textContent).not.toContain('見つかりませんでした')
  })

  it('本当に無い（404）ときは「見つかりませんでした」', async () => {
    net.runsStatus = 404
    await view.render(<Page />)
    await settle()
    expect(view.host.textContent).toContain('定期レポートが見つかりませんでした')
  })
})
