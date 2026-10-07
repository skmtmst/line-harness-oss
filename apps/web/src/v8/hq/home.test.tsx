// @vitest-environment happy-dom
/*
 * V8 統括のアカウント（src/v8/hq/home.tsx）の動きの試験。
 * LINE ID の @ を二重にしない、要確認のカードに引っかかった確認の言葉を出す（全文は title）、
 * 閲覧のみには「更新する」を置かない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const accounts = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: accounts },
      lineAccountTags: { ...actual.api.lineAccountTags, list: vi.fn(async () => ({ success: true, data: [] })) },
      tenants: { ...actual.api.tenants, me: vi.fn(async () => ({ success: true, data: { name: '然 -NEN-' } })) },
    },
  }
})
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/hq/platform-notices', () => ({ default: () => null }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ setSelectedAccountId: () => {}, refreshAccounts: async () => {} }),
}))

import HqHomeV8 from './home'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const warnedAccount = {
  id: 'acc-1', revision: 1, channelId: '2000000001', name: '然 -NEN- TEST', displayName: '然 -NEN- TEST',
  basicId: '@273ytrca', isActive: true, country: null, role: null, displayOrder: 0, archivedAt: null, tags: [],
  stats: { friendCount: 3, activeScenarios: 0, messagesThisMonth: 0, staffCount: 1 },
  connection: {
    status: 'warn', checkedAt: '2026-10-07T10:00:00+09:00', tokenExpired: false,
    issues: [{
      kind: 'webhook_endpoint', result: 'mismatched', expectedUrl: 'https://stg-api.musubo.jp/webhook',
      registeredUrl: 'https://old.example.test/webhook', webhookActive: true, httpStatus: 200,
    }],
  },
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  accounts.mockResolvedValue({ success: true, data: [warnedAccount] })
  role.value = 'owner'
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => { root.render(<HqHomeV8 />) })
  await act(async () => { await Promise.resolve() })
}

describe('統括のアカウント', () => {
  it('LINE ID の @ を二重にしない', async () => {
    await render()
    const card = container.querySelector('article')!
    expect(card.textContent).toContain('@273ytrca')
    expect(card.textContent).not.toContain('@@')
  })

  it('要確認のカードは、引っかかった確認の言葉を出し、全文を title に持つ', async () => {
    await render()
    const card = container.querySelector('article')!
    const reason = card.querySelector('[title*="old.example.test"]')
    expect(reason?.textContent).toContain('Webhook の URL がこの環境と違います')
    expect(card.textContent).not.toContain('LINE ID・接続状態を確かめてください')
    expect([...card.querySelectorAll('button')].some((button) => button.textContent === '更新する')).toBe(true)
  })

  it('閲覧のみには「更新する」を置かない', async () => {
    role.value = 'viewer'
    await render()
    const card = container.querySelector('article')!
    expect([...card.querySelectorAll('button')].some((button) => button.textContent === '更新する')).toBe(false)
  })
})
