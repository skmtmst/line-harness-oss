// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'
const writes = vi.hoisted(() => ({ create: vi.fn(), rotate: vi.fn(), revoke: vi.fn() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('./shell', () => ({ useWebhookOverview: () => ({}) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, webhooks: { ...actual.api.webhooks,
    apiTokens: { ...actual.api.webhooks.apiTokens, list: async () => ({ success: true, data: [] }), ...writes },
  } } }
})
import { useApiTokens } from './use-api-tokens'
beforeEach(() => { vi.clearAllMocks(); verifiedStaffRole('owner'); forgetSessionSnapshot() })
afterEach(() => { cleanup(); verifiedStaffRole(null); forgetSessionSnapshot() })
it('管理者の空一覧の入口はownerの理由を持ち、直接呼んでも発行しない', async () => {
  verifiedStaffRole('admin')
  const { result } = renderHook(useApiTokens)
  expect(result.current.ownership.reason).toBe('この操作はオーナーだけができます。')
  act(() => result.current.openCreate())
  expect(result.current.createOpen).toBe(false)
  await act(async () => result.current.handleCreate())
  expect(writes.create).not.toHaveBeenCalled()
})
it('本人が分からない時は理由を作らず拒否する', async () => {
  verifiedStaffRole(null)
  const { result } = renderHook(useApiTokens)
  expect(result.current.ownership).toEqual({ known: false, allowed: false, reason: undefined })
  await act(async () => result.current.handleCreate())
  expect(writes.create).not.toHaveBeenCalled()
})
it('本人変更後は、保持した発行・入れ替え・停止の操作も0回', async () => {
  const { result } = renderHook(useApiTokens)
  act(() => {
    result.current.setName('外部システム')
    result.current.setRotateTarget({ id: 'key', name: '鍵', scopes: ['tags:read'] } as never)
    result.current.setRevokeTarget({ id: 'key', name: '鍵' } as never)
  })
  const old = result.current
  verifiedStaffRole('admin')
  await act(async () => { await old.handleCreate(); await old.handleRotate(); await old.handleRevoke() })
  expect(writes.create).not.toHaveBeenCalled()
  expect(writes.rotate).not.toHaveBeenCalled()
  expect(writes.revoke).not.toHaveBeenCalled()
})
it('オーナーは名前と範囲を確認して発行できる', async () => {
  writes.create.mockResolvedValue({ success: true, data: { name: '接続', token: 'fixture', scopes: ['tags:read'] } })
  const { result } = renderHook(useApiTokens)
  act(() => result.current.setName('接続'))
  await act(async () => result.current.handleCreate())
  expect(writes.create).toHaveBeenCalledOnce()
  expect(writes.create).toHaveBeenCalledWith('account-a', expect.objectContaining({ name: '接続', scopes: expect.any(Array) }), undefined)
})
