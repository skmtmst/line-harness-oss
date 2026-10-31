// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { forgetStaffIdentity, rememberStaffIdentity, readStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
import StoreSelectionGate from './store-selection-gate'

const mocks = vi.hoisted(() => ({ state: vi.fn(), replace: vi.fn(), pathname: '/chats', loading: false }))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname, useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  loading: mocks.loading, selectedAccountId: 'the-shed', accounts: [{ id: 'the-shed' }],
  error: null, refreshing: false, refreshAccounts: vi.fn(),
}) }))
vi.mock('@/lib/api', () => ({ api: { lineAccounts: { followerImportState: mocks.state } } }))

beforeEach(() => { vi.clearAllMocks(); mocks.pathname = '/chats'; mocks.loading = false })
afterEach(() => { cleanup(); forgetStaffIdentity() })

describe('保存済みの店舗選択からの再訪', () => {
  it('店舗一覧の待機は共通の骨組みにし、検証台本が識別できる印を保つ', () => {
    mocks.loading = true
    render(<StoreSelectionGate><div>店舗画面</div></StoreSelectionGate>)
    expect(document.querySelector('[data-page-pending="store"] [aria-busy="true"]')).toBeTruthy()
    expect(screen.queryByText('店舗画面')).toBeNull()
  })

  it('引き継ぎ中なら店舗画面をマウントせずPenの進捗画面へ戻す', async () => {
    mocks.state.mockResolvedValue({ success: true, data: { phase: 'importing_ids' } })
    render(<StoreSelectionGate><div>店舗画面</div></StoreSelectionGate>)
    expect(screen.queryByText('店舗画面')).toBeNull()
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/accounts/new/handover?accountId=the-shed'))
    expect(screen.queryByText('店舗画面')).toBeNull()
  })

  it('状態確認に失敗しても店舗画面を開かない', async () => {
    mocks.state.mockRejectedValue(new Error('network error'))
    render(<StoreSelectionGate><div>店舗画面</div></StoreSelectionGate>)
    await screen.findByText('友だちの引き継ぎ状態を確認できません')
    expect(screen.queryByText('店舗画面')).toBeNull()
  })

  it('受信箱の権限を持つstaffが状態を読めれば店舗画面を表示する', async () => {
    rememberStaffIdentity({ id: 'staff-1', role: 'staff', permissionKeys: ['/chats'] } as StaffMember)
    expect(readStaffIdentity()?.role).toBe('staff')
    mocks.state.mockResolvedValue({ success: true, data: { phase: 'not_started' } })
    render(<StoreSelectionGate><div>担当者の受信箱</div></StoreSelectionGate>)
    await screen.findByText('担当者の受信箱')
    expect(mocks.state).toHaveBeenCalledWith('the-shed')
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(screen.queryByText('友だちの引き継ぎ状態を確認できません')).toBeNull()
  })

  it('完了後だけ店舗画面を開く', async () => {
    mocks.state.mockResolvedValue({ success: true, data: { phase: 'completed' } })
    render(<StoreSelectionGate><div>店舗画面</div></StoreSelectionGate>)
    await screen.findByText('店舗画面')
  })

  it('統括と引き継ぎ画面では入店ガードをかけず、進捗を表示できる', () => {
    for (const pathname of ['/hq', '/accounts/new/handover']) {
      mocks.pathname = pathname
      const view = render(<StoreSelectionGate><div>引き継ぎ画面</div></StoreSelectionGate>)
      expect(screen.getByText('引き継ぎ画面')).toBeTruthy()
      view.unmount()
    }
    expect(mocks.state).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
