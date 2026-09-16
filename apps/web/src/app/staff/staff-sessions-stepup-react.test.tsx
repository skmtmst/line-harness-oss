// @vitest-environment happy-dom
/*
 * N-427 (#850) 本人の端末一覧・失効と、権限変更の直前再認証を、実物の画面で確かめる。
 *
 *   - 「ログイン中の端末」に自分のセッションが並び、今の端末に印が付く
 *   - 他の端末は1件ずつ終了でき、現在の端末は確認を挟んで /login へ戻る
 *   - 「この端末以外をすべて終了」が一括失効口を叩く
 *   - 権限の保存が 428 STEP_UP_REQUIRED で止まったとき、本人確認の窓が立ち、
 *     6桁コード → grant 取得 → 同じ保存に grant を付けてやり直す
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  tab: 'members',
  sessionsList: vi.fn(),
  sessionsRevoke: vi.fn(),
  sessionsRevokeOthers: vi.fn(),
  staffUpdate: vi.fn(),
  staffStepUp: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/staff',
  useSearchParams: () => new URLSearchParams(`tab=${fixture.tab}`),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => <nav aria-label="ログインユーザーのタブ" />,
  useMergedTab: () => fixture.tab,
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/staff/login-audit', () => ({ default: () => <div /> }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('') } }))

const SESSIONS = [
  { id: 'hash-current', current: true, createdAt: '2026-09-08T01:00:00.000Z', expiresAt: '2026-09-09T01:00:00.000Z', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', ipPrefix: '203.0.*.*' },
  { id: 'hash-phone', current: false, createdAt: '2026-09-07T01:00:00.000Z', expiresAt: '2026-09-14T01:00:00.000Z', userAgent: 'Mozilla/5.0 (iPhone) Safari/604', ipPrefix: null },
]

function member(overrides: Partial<StaffMember>): StaffMember {
  return {
    id: 'member-1', name: '対象の人', email: 'member@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: [],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  } as StaffMember
}
function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'member-1', name: '対象の人', email: 'member@example.test', jobTitle: null,
    roleBundle: 'operations', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: null, lastActionAt: null, mfaEnabled: false, status: 'active', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', ...overrides,
  }
}

const state = {
  members: [] as StaffMember[],
  users: [] as ReturnType<typeof accessUser>[],
}

class MockApiError extends Error {
  status: number
  code: string | undefined
  constructor(status: number, message?: string, code?: string) {
    super(message || `API error: ${status}`)
    this.status = status
    this.code = code
  }
}

vi.mock('@/lib/api', () => ({
  ApiError: MockApiError,
  fetchApi: vi.fn(),
  api: {
    staff: {
      list: async () => ({ success: true, data: state.members }),
      me: async () => ({ success: true, data: member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: 'admin' }) }),
      update: (...args: unknown[]) => fixture.staffUpdate(...args),
      stepUp: (...args: unknown[]) => fixture.staffStepUp(...args),
      loginSummary: async () => ({ success: true, data: { loginCount: 0 } }),
      lastLogins: async () => ({ success: true, data: {} }),
    },
    sessions: {
      list: () => fixture.sessionsList(),
      revoke: (...args: unknown[]) => fixture.sessionsRevoke(...args),
      revokeOthers: () => fixture.sessionsRevokeOthers(),
    },
    lineAccounts: { list: async () => ({ success: true, data: [] }) },
    access: {
      users: async () => ({
        success: true,
        data: {
          items: state.users,
          summary: { active: 1, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 0, mfaRate: null, roleCounts: { administrator: 0, operations: 1, reception: 0, view_only: 0, custom: 0 } },
          pagination: { total: state.users.length, limit: 200, offset: 0 },
        },
      }),
      roles: async () => ({ success: true, data: { items: [] } }),
    },
    audit: { events: async () => ({ success: true, data: { items: [] } }) },
  },
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: StaffPage } = await import('./page')

const locationAssign = vi.fn()

async function mount() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => expect(screen.getByText('対象の人')).toBeTruthy())
  await waitFor(() => expect(screen.getByText('ログイン中の端末')).toBeTruthy())
}

beforeEach(() => {
  fixture.tab = 'members'
  fixture.sessionsList.mockReset().mockResolvedValue({ success: true, data: { sessions: SESSIONS } })
  fixture.sessionsRevoke.mockReset().mockResolvedValue({ success: true, data: { revoked: 1, current: false } })
  fixture.sessionsRevokeOthers.mockReset().mockResolvedValue({ success: true, data: { revoked: 1 } })
  fixture.staffUpdate.mockReset()
  fixture.staffStepUp.mockReset()
  state.members = [member({})]
  state.users = [accessUser({})]
  locationAssign.mockReset()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: locationAssign },
  })
})
afterEach(() => { cleanup() })

describe('ログイン中の端末 (N-427)', () => {
  it('自分のセッションが並び、今の端末に印が付く', async () => {
    await mount()
    expect(fixture.sessionsList).toHaveBeenCalledTimes(1)
    expect(screen.getByText('この端末')).toBeTruthy()
    expect(screen.getByText(/iPhone \/ iPad・Safari/)).toBeTruthy()
  })

  it('他の端末は確認なしで1件終了できる', async () => {
    await mount()
    const buttons = screen.getAllByRole('button', { name: 'ログインを終了' })
    // 2件目が他端末
    await act(async () => { fireEvent.click(buttons[1]) })
    expect(fixture.sessionsRevoke).toHaveBeenCalledWith('hash-phone', { confirmCurrent: false })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ログインを終了しました'))
  })

  it('今の端末は確認を挟み、確定するとログイン画面へ戻る', async () => {
    await mount()
    const buttons = screen.getAllByRole('button', { name: 'ログインを終了' })
    // 1件目が現在の端末。押してもまだ消さず、確認窓が立つ。
    await act(async () => { fireEvent.click(buttons[0]) })
    expect(fixture.sessionsRevoke).not.toHaveBeenCalled()
    await screen.findByText('この端末のログインを終了しますか？')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この端末を終了する' })) })
    expect(fixture.sessionsRevoke).toHaveBeenCalledWith('hash-current', { confirmCurrent: true })
    await waitFor(() => expect(locationAssign).toHaveBeenCalledWith('/login'))
  })

  it('この端末以外をすべて終了できる', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この端末以外をすべて終了' })) })
    await screen.findByText('この端末以外のログインをすべて終了しますか？')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'すべて終了する' })) })
    expect(fixture.sessionsRevokeOthers).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 件のログインを終了しました'))
  })
})

describe('権限変更の直前再認証 (N-427)', () => {
  async function openEditModal() {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '変更する' })) })
    await screen.findByText('見せる範囲を決める')
  }

  it('保存が 428 で止まったら本人確認の窓が立ち、grant を付けて保存し直す', async () => {
    fixture.staffUpdate
      .mockRejectedValueOnce(new MockApiError(428, '権限の変更には二段階認証による再認証が必要です', 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ success: true, data: member({ role: 'admin' }) })
    fixture.staffStepUp.mockResolvedValue({ success: true, data: { token: 'grant-token-1', purpose: 'staff.permissions.change', expiresAt: '2026-09-08T01:05:00.000Z' } })

    await openEditModal()
    // 役割を「管理者」へ変えて保存
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '管理者' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /変更を保存/ })) })

    // 1回目は grant 無しで止められ、本人確認の窓が立つ
    await screen.findByText('認証アプリで本人確認')
    expect(fixture.staffUpdate).toHaveBeenCalledTimes(1)
    expect(fixture.staffUpdate.mock.calls[0][2]).toBeUndefined()

    // 6桁コードを入れると grant を取り、同じ保存へ token を付けてやり直す
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '本人確認して実行' })) })

    expect(fixture.staffStepUp).toHaveBeenCalledWith('123456', 'staff.permissions.change')
    await waitFor(() => expect(fixture.staffUpdate).toHaveBeenCalledTimes(2))
    expect(fixture.staffUpdate.mock.calls[1][2]).toBe('grant-token-1')
    expect(screen.queryByText('認証アプリで本人確認')).toBeNull()
  })

  it('権限に触れない変更（メールだけ）は再認証なしで通る', async () => {
    fixture.staffUpdate.mockResolvedValue({ success: true, data: member({}) })
    await openEditModal()
    fireEvent.change(screen.getByDisplayValue('member@example.test'), { target: { value: 'new@example.test' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /変更を保存/ })) })
    await waitFor(() => expect(fixture.staffUpdate).toHaveBeenCalledTimes(1))
    expect(fixture.staffStepUp).not.toHaveBeenCalled()
    expect(screen.queryByText('認証アプリで本人確認')).toBeNull()
  })
})
