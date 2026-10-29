// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import type { AutoReply } from './list-model'
import { toggleAutoReply } from './list-toggle-action'
import { duplicateAutoReply } from './list-duplicate-action'

const net = vi.hoisted(() => ({
  stop: vi.fn(), update: vi.fn(), create: vi.fn(),
  toast: vi.fn((_message: string, _options?: { onAction?: () => void; actionLabel?: string }) => () => {}),
}))
vi.mock('@/components/shared/toast', () => ({ notifyToast: net.toast }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, autoReplies: { ...actual.api.autoReplies, stop: net.stop, update: net.update, create: net.create } } }
})

const row: AutoReply = {
  id: 'rule-one', keyword: '予約', matchType: 'contains', responseType: 'text', responseContent: '保存した文',
  templateId: null, lineAccountId: 'account-a', isActive: true, activeFrom: null, activeUntil: null,
  cooldownMinutes: null, skipWhenOperatorActive: false, priority: 1, messageKinds: null, receiveSources: ['line'],
  actions: null, responseWeekdays: null, responseHolidayRule: null, oncePerFriend: false, keywords: null,
  friendConditions: null, respondToAll: false, name: '予約受付', keywordMatchMode: 'any', folderId: null,
  internalMemo: '保存したメモ', lifecycleStatus: 'published', stoppedAt: null, stoppedByStaffId: null,
  stoppedByStaffName: null, stopReason: null, createdAt: '',
}
const proxy = (mode: 'read' | 'write') => ({ impersonation: { id: 'proxy', tenantId: 'tenant', mode, piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' as const })
const restrict = (kind: string) => {
  if (kind === 'unknown') forgetStaffIdentity()
  else if (kind === 'read-proxy') rememberSessionSnapshot(proxy('read'))
  else rememberStaffIdentity({ ...readStaffIdentity()!, role: kind === 'viewer' ? 'viewer' : 'staff', permissionKeys: [], ...(kind === 'readOnly' ? { readOnly: true } : kind === 'view_only' ? { roleBundle: 'view_only' as const } : {}) })
}
const toggleContext = (ids = [row.id], kind: 'stop' | 'resume' = 'stop'): Parameters<typeof toggleAutoReply>[0] => ({
  listContextKey: 'account-a:list', load: vi.fn(async () => {}), pendingToggle: { ids, names: ids, kind, accountId: 'account-a' },
  rules: [row, { ...row, id: 'rule-two' }], saveErrors: renderHook(useSaveFormErrors).result.current,
  selectedAccountId: 'account-a', selectedAccountIdRef: { current: 'account-a' },
  setOptimisticRows: vi.fn(), setPendingToggle: vi.fn(), setSelectedIds: vi.fn(), setToggleError: vi.fn(), setToggleReason: vi.fn(), toggleReason: '停止の理由',
})
const duplicateContext = (): Parameters<typeof duplicateAutoReply>[0] => ({
  duplicateFeedback: { highlightedId: null, clear: vi.fn(), mark: vi.fn(), order: rows => rows },
  duplicateKeysRef: { current: new Map() }, duplicateLock: { current: false }, duplicating: false,
  load: vi.fn(async () => {}), nextPriority: 3, saveErrors: renderHook(useSaveFormErrors).result.current,
  selectedAccountId: 'account-a', setDuplicateError: vi.fn(), setDuplicating: vi.fn(),
})
beforeEach(() => {
  verifiedStaffRole('owner'); forgetSessionSnapshot(); vi.clearAllMocks()
  net.stop.mockReset().mockResolvedValue({ success: true, data: null })
  net.update.mockReset().mockResolvedValue({ success: true, data: null })
  net.create.mockReset().mockResolvedValue({ success: true, data: { id: 'copy' } })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })

it.each(['unknown', 'viewer', 'readOnly', 'view_only', 'staff-no-key', 'read-proxy'])('%sへ変わった後の保持された停止・複製は送らず、通常編集へ戻ると動く', async kind => {
  const stop = toggleContext(), copy = duplicateContext()
  restrict(kind)
  toggleAutoReply(stop); await duplicateAutoReply(copy, row)
  expect(net.stop).not.toHaveBeenCalled(); expect(net.create).not.toHaveBeenCalled()
  expect(stop.setOptimisticRows).not.toHaveBeenCalled(); expect(copy.setDuplicating).not.toHaveBeenCalled()
  verifiedStaffRole('owner'); rememberSessionSnapshot(proxy('write'))
  toggleAutoReply(stop); await duplicateAutoReply(copy, row)
  await waitFor(() => expect(stop.load).toHaveBeenCalledTimes(1))
  expect(net.stop).toHaveBeenCalledTimes(1); expect(net.create).toHaveBeenCalledTimes(1)
})

it.each(['owner', 'admin', 'staff'] as const)('%sの既存の編集権限では再開と停止中の複製を妨げない', async role => {
  verifiedStaffRole(role)
  if (role === 'staff') rememberStaffIdentity({ ...readStaffIdentity()!, permissionKeys: [DELIVERY_FEATURE_POLICIES.autoReplies.key, deliveryPermissionKey('autoReplies', 'edit')] })
  const resume = toggleContext([row.id], 'resume'), copy = duplicateContext()
  toggleAutoReply(resume); await duplicateAutoReply(copy, row)
  await waitFor(() => expect(resume.load).toHaveBeenCalledTimes(1))
  expect(net.update).toHaveBeenCalledExactlyOnceWith(row.id, { isActive: true })
  expect(net.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, name: '予約受付（コピー）', internalMemo: '保存したメモ', responseContent: '保存した文' }), expect.any(String))
})

it.each(['stop', 'resume'] as const)('まとめて%sの1件目を待つ間にread代理へ変わったら、2件目を送らず表示を読み直す', async kind => {
  let release!: (value: { success: boolean; data: null }) => void
  const send = kind === 'stop' ? net.stop : net.update
  send.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const context = toggleContext([row.id, 'rule-two'], kind)
  toggleAutoReply(context)
  expect(send).toHaveBeenCalledTimes(1)
  rememberSessionSnapshot(proxy('read')); release({ success: true, data: null })
  await waitFor(() => expect(context.load).toHaveBeenCalledTimes(1))
  expect(send).toHaveBeenCalledTimes(1)
  expect(context.setOptimisticRows).toHaveBeenLastCalledWith(null)
  expect(net.toast).not.toHaveBeenCalled()
})

it('停止失敗の保持された再試行はread代理で送らず、復帰後は同じ確認キーで送る', async () => {
  net.stop.mockRejectedValueOnce(new Error('通信失敗'))
  const context = toggleContext()
  toggleAutoReply(context)
  await waitFor(() => expect(net.toast).toHaveBeenCalledTimes(1))
  const retry = net.toast.mock.calls[0][1]!.onAction!
  expect(retry).toBeTypeOf('function')
  const key = net.stop.mock.calls[0][2], optimisticCalls = vi.mocked(context.setOptimisticRows).mock.calls.length
  rememberSessionSnapshot(proxy('read')); retry()
  expect(net.stop).toHaveBeenCalledTimes(1)
  expect(vi.mocked(context.setOptimisticRows).mock.calls).toHaveLength(optimisticCalls)
  rememberSessionSnapshot(proxy('write')); retry()
  await waitFor(() => expect(net.stop).toHaveBeenCalledTimes(2))
  expect(net.stop.mock.calls[1][2]).toBe(key)
})

it('まとめて停止の途中でアカウントが変わると、古いアカウントの2件目を送らない', async () => {
  let release!: (value: { success: boolean; data: null }) => void
  net.stop.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const context = toggleContext([row.id, 'rule-two'])
  toggleAutoReply(context); context.selectedAccountIdRef.current = 'account-b'; release({ success: true, data: null })
  await waitFor(() => expect(context.setOptimisticRows).toHaveBeenLastCalledWith(null))
  expect(net.stop).toHaveBeenCalledTimes(1)
  expect(context.load).not.toHaveBeenCalled()
  expect(net.toast).not.toHaveBeenCalled()
})
