// @vitest-environment happy-dom
/*
 * N-012: ダッシュボード運用アラートの二段階認証の行が、選択中の
 * LINEアカウントではなく組織全体の集計だと読めるかを確かめる。
 *
 * 実ページを実Reactで描き、/api/staff の応答だけを差し替える。
 * 集計（有効なログイン利用者だけを数える）の契約自体は
 * components/dashboard/dashboard-v4.test.ts が持ち、ここでは
 * 文言と表示される数の両方を端から見る。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './page'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '店' }, loading: false }),
}))

let host: HTMLDivElement
let root: Root
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

const member = (id: string, twoFactorEnabled: boolean, isActive = true) => ({
  id,
  name: id,
  email: null,
  role: 'staff',
  lineLinked: false,
  twoFactorEnabled,
  isActive,
  permissionKeys: [],
  notificationPreferences: {},
  inviteStatus: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  assignedLineAccountId: null,
  canAccessDescendantAccounts: false,
})

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    key: () => null, length: 0,
  })
  vi.stubGlobal('sessionStorage', {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    key: () => null, length: 0,
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const path = String(input)
    if (path.endsWith('/api/staff')) {
      // 組織全体のログイン利用者。選択中アカウントとは無関係の全体集計。
      return Promise.resolve(json({ success: true, data: [
        member('enabled', true),
        member('disabled', false),
        member('inactive', false, false),
      ] }))
    }
    if (path.includes('/api/dashboard/preferences?')) {
      return Promise.resolve(json({ success: true, data: { version: 7, cards: {} } }))
    }
    return Promise.resolve(json({ success: false, error: 'not available' }, 404))
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
})

describe('N-012 ダッシュボードの二段階認証表記', () => {
  it('組織全体の集計だと分かる表記で、有効な利用者だけを数える', async () => {
    await act(async () => { root.render(<DashboardPage />) })
    await act(async () => { await Promise.resolve() })
    // 選択中アカウントの話ではなく、組織全体の話だと行だけで分かる。
    expect(host.textContent).toContain('組織全体の二段階認証：1 / 2人')
    // 有効な利用者2人のうち1人が有効。無効な人は分母に入らない。
    expect(host.textContent).not.toContain('1 / 3人')
  })
})
