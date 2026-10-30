// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { StaffMember } from '@line-crm/shared'
import StaffV8 from './staff'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'

const state = vi.hoisted(() => ({ account: 'account-a', members: vi.fn(), fetch: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/staff',
  useSearchParams: () => new URLSearchParams('tab=members'),
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/components/step-up-prompt', () => ({ default: () => null, isStepUpRequired: () => false, useStepUpGate: () => ({ gate: vi.fn(), prompt: null }) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: state.fetch, api: {
    ...actual.api,
    staff: { ...actual.api.staff, list: state.members, me: async () => ({ success: true, data: person('staff-fixture', true) }) },
    lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [{ id: 'account-a', name: '通知' }, { id: 'account-b', name: '別のLINE' }] }) },
    access: { ...actual.api.access,
      users: async () => ({ success: true, data: { items: [], pagination: { total: 0, limit: 200, offset: 0 }, summary: { active: 0, suspended: 0, invited: 0, mfaEnabled: 0 }, } }),
      roles: async () => ({ success: true, data: { items: [] } }),
    },
  } }
})

function person(id: string, twoFactorEnabled: boolean): StaffMember {
  return { id, name: id, email: null, role: 'owner', tenantId: 'tenant-a',
    twoFactorEnabled, isActive: true, inviteStatus: 'active', lineLinked: false,
    notificationPreferences: {}, permissionKeys: [], assignedLineAccountId: null,
    canAccessDescendantAccounts: false, createdAt: '', updatedAt: '',
  }
}
const response = (id: string, enabled: boolean) => ({ success: true, data: [person(id, enabled)] })

beforeEach(() => {
  state.account = 'account-a'; state.members.mockReset(); state.fetch.mockReset()
  verifiedStaffRole('owner')
  state.fetch.mockImplementation(async (path: string) => ({ success: true, data: path.endsWith('/policy')
    ? { required: false, canEdit: true, registered: 5, total: 7 }
    : { enabledAt: null, remaining: 0, total: 8, canEdit: false } }))
})
afterEach(() => { cleanup(); verifiedStaffRole(null) })

it('feeds the selected account staff into the security count instead of the tenant policy totals', async () => {
  state.members.mockResolvedValue(response('me', true))
  render(<StaffV8 />)
  await screen.findByText('1 / 1 人')
  expect(state.members).toHaveBeenCalledWith('account-a')
  expect(screen.queryByText('5 / 7 人')).toBeNull()
})

it('ignores a late staff response from the account selected before switching', async () => {
  let resolveFirst!: (value: ReturnType<typeof response>) => void
  state.members.mockImplementation((accountId: string) => accountId === 'account-a'
    ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve(response('other', false)))
  const view = render(<StaffV8 />)
  await waitFor(() => expect(state.members).toHaveBeenCalledWith('account-a'))
  state.account = 'account-b'
  view.rerender(<StaffV8 />)
  await screen.findByText('0 / 1 人')
  await act(async () => resolveFirst(response('me', true)))
  expect(screen.getByText('0 / 1 人')).toBeTruthy()
  expect(screen.queryByText('1 / 1 人')).toBeNull()
  expect(screen.queryByText('5 / 7 人')).toBeNull()
})

it('shows unknown counts on an account read failure and never falls back to the tenant count', async () => {
  state.members.mockRejectedValue(new Error('unavailable'))
  render(<StaffV8 />)
  await screen.findByText('ログインユーザーを読み込めませんでした。登録した内容は消えていません。')
  expect(screen.getByText('— / — 人')).toBeTruthy()
  expect(screen.queryByText('5 / 7 人')).toBeNull()
})
