// @vitest-environment happy-dom
/*
 * 監査 WEB203：ログインユーザーが200人より多いとき、続きを読み込める。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const net = vi.hoisted(() => ({ users: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/staff',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc', loading: false }) }))
vi.mock('@/components/shell/page-chrome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shell/page-chrome')>()
  return { ...actual, usePageTitle: () => undefined, usePageCrumbs: () => undefined }
})
const user = vi.hoisted(() => (i: number) => ({
  id: `u${i}`, name: `利用者${i}`, email: null, jobTitle: null, roleBundle: 'staff', featureCount: null, hasFieldMasks: null,
  accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
  lastLoginAt: null, lastActionAt: null, mfaEnabled: false, status: 'active', policyVersion: 1, createdAt: '', updatedAt: '',
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, list: async () => ({ success: true, data: [] }), me: async () => ({ success: true, data: { id: 'me', role: 'owner', name: '自分' } }) },
      lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [] }) },
      access: {
        ...actual.api.access,
        users: (...args: unknown[]) => net.users(...args),
        roles: async () => ({ success: true, data: { items: [] } }),
      },
    },
  }
})

import StaffV8 from './staff'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('全員より少ないときは「続きを読み込む」で残りを足す', async () => {
  net.users.mockImplementation(async (params: { offset?: number }) => {
    const offset = params.offset ?? 0
    const count = offset === 0 ? 200 : 50
    return {
      success: true,
      data: {
        items: Array.from({ length: count }, (_, i) => user(offset + i)),
        pagination: { total: 250, limit: 200, offset },
        summary: { active: 250, suspended: 0, mfaEnabled: 0, invited: 0 },
      },
    }
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  render(<StaffV8 />)
  const more = await screen.findByRole('button', { name: '続きを読み込む' })
  await act(async () => { more.click() })
  await waitFor(() => expect(net.users).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 200 })))
  await waitFor(() => expect(screen.queryByRole('button', { name: '続きを読み込む' })).toBeNull())
})
