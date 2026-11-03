// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'
import { ApiError } from '@/lib/api'
const writes = vi.hoisted(() => ({ account: 'account-a', create: vi.fn(), rotate: vi.fn(), revoke: vi.fn(), list: vi.fn() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: writes.account }) }))
vi.mock('./shell', () => ({ useWebhookOverview: () => ({}) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, webhooks: { ...actual.api.webhooks,
    apiTokens: { ...actual.api.webhooks.apiTokens, list: async () => ({ success: true, data: [] }), ...writes },
  } } }
})
import { useApiTokens } from './use-api-tokens'
beforeEach(() => { vi.resetAllMocks(); writes.account = 'account-a'; writes.list.mockResolvedValue({ success: true, data: [] }); verifiedStaffRole('owner'); forgetSessionSnapshot() })
afterEach(() => { cleanup(); verifiedStaffRole(null); forgetSessionSnapshot() })
it.each(['rotate', 'revoke'] as const)('鍵の%s確認中にアカウントを切り替えたら古い操作を送らない', async (kind) => {
  const view = renderHook(useApiTokens)
  await act(async () => {})
  act(() => {
    if (kind === 'rotate') view.result.current.setRotateTarget({ id: 'key', name: '鍵', scopes: ['tags:read'] } as never)
    else view.result.current.setRevokeTarget({ id: 'key', name: '鍵' } as never)
  })
  writes.account = 'account-b'; view.rerender()
  await act(async () => { if (kind === 'rotate') await view.result.current.handleRotate(); else await view.result.current.handleRevoke() })
  expect(writes.rotate).not.toHaveBeenCalled()
  expect(writes.revoke).not.toHaveBeenCalled()
})
it.each(['rotate', 'revoke'] as const)('A→B→A の後も古い%s確定を使えない', async (kind) => {
  const view = renderHook(useApiTokens)
  await act(async () => {})
  act(() => {
    if (kind === 'rotate') view.result.current.setRotateTarget({ id: 'key', name: '鍵', scopes: ['tags:read'] } as never)
    else view.result.current.setRevokeTarget({ id: 'key', name: '鍵' } as never)
  })
  const old = view.result.current
  writes.account = 'account-b'; view.rerender()
  writes.account = 'account-a'; view.rerender()
  await act(async () => { if (kind === 'rotate') await old.handleRotate(); else await old.handleRevoke() })
  expect(writes.rotate).not.toHaveBeenCalled()
  expect(writes.revoke).not.toHaveBeenCalled()
})
it.each(['rotate', 'revoke'] as const)('対象が同じ時は%sを元のアカウントへ送る', async (kind) => {
  writes[kind].mockResolvedValue({ success: true, data: { id: 'key', name: '鍵', token: 'fixture', scopes: [] } })
  const view = renderHook(useApiTokens)
  await act(async () => {})
  act(() => {
    if (kind === 'rotate') view.result.current.setRotateTarget({ id: 'key', name: '鍵', scopes: [] } as never)
    else view.result.current.setRevokeTarget({ id: 'key', name: '鍵' } as never)
  })
  await act(async () => { if (kind === 'rotate') await view.result.current.handleRotate(); else await view.result.current.handleRevoke() })
  expect(writes[kind]).toHaveBeenCalledWith('key', 'account-a', undefined)
})
it('A→B→A の後に最初の一覧が返っても現在の一覧を上書きしない', async () => {
  let resolveOld!: (value: unknown) => void
  writes.list.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  const view = renderHook(useApiTokens)
  writes.account = 'account-b'; view.rerender()
  await act(async () => {})
  writes.account = 'account-a'; view.rerender()
  await act(async () => {})
  await act(async () => { resolveOld({ success: true, data: [{ id: 'old-key', name: '古い鍵', revokedAt: null }] }) })
  expect(view.result.current.tokens).toEqual([])
})
it.each(['rotate', 'revoke'] as const)('アカウント切替後に本人確認の古い%sを再開しない', async (kind) => {
  writes[kind].mockRejectedValueOnce(new ApiError(428, '本人確認', 'STEP_UP_REQUIRED'))
  const view = renderHook(useApiTokens)
  await act(async () => {})
  act(() => {
    if (kind === 'rotate') view.result.current.setRotateTarget({ id: 'key', name: '鍵', scopes: [] } as never)
    else view.result.current.setRevokeTarget({ id: 'key', name: '鍵' } as never)
  })
  await act(async () => { if (kind === 'rotate') await view.result.current.handleRotate(); else await view.result.current.handleRevoke() })
  const retry = view.result.current.stepUp?.retry
  expect(retry).toBeDefined()
  writes.account = 'account-b'; view.rerender()
  writes.account = 'account-a'; view.rerender()
  await act(async () => { await retry?.('fixture') })
  expect(writes[kind]).toHaveBeenCalledTimes(1)
})
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
