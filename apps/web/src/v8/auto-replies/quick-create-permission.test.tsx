// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'

const net = vi.hoisted(() => ({ createDraft: vi.fn(), saveDraft: vi.fn(), conflicts: vi.fn(), publishDraft: vi.fn(), me: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, autoReplies: { ...actual.api.autoReplies, ...net }, staff: { ...actual.api.staff, me: net.me } } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
import QuickCreate from './quick-create'

const proxy = (mode: 'read' | 'write') => ({ impersonation: { id: 'proxy', tenantId: 'tenant', mode, piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' as const })
const overlap = { autoReplyId: 'rule', name: '既存ルール' }
const made = { success: true, data: { autoReplyId: 'draft', versionNumber: 1 } }
const callbacks = { onClose: vi.fn(), onCreated: vi.fn() }
const input = () => screen.getByLabelText('追加する言葉') as HTMLInputElement
const reply = () => screen.getByLabelText('返す文') as HTMLTextAreaElement
const saveButton = () => screen.getByRole('button', { name: '有効にして保存' }) as HTMLButtonElement
const clickSave = async () => { await act(async () => { fireEvent.click(saveButton()) }) }
function fill() {
  fireEvent.change(input(), { target: { value: '営業時間' } })
  fireEvent.keyDown(input(), { key: 'Enter' })
  fireEvent.change(reply(), { target: { value: '10時からです' } })
}
function restrict(kind: string) {
  act(() => {
    if (kind === 'unknown') forgetStaffIdentity()
    else if (kind === 'read-proxy') rememberSessionSnapshot(proxy('read'))
    else rememberStaffIdentity({ ...readStaffIdentity()!, role: kind === 'viewer' ? 'viewer' : 'staff', permissionKeys: [], ...(kind === 'readOnly' ? { readOnly: true } : kind === 'view_only' ? { roleBundle: 'view_only' as const } : {}) })
  })
}
beforeEach(() => {
  verifiedStaffRole('owner'); forgetSessionSnapshot(); vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
  net.createDraft.mockReset().mockResolvedValue(made)
  net.saveDraft.mockReset().mockResolvedValue({ success: true, data: { autoReplyId: 'draft', versionNumber: 2 } })
  net.conflicts.mockReset().mockResolvedValue({ success: true, data: { conflicts: [] } })
  net.publishDraft.mockReset().mockResolvedValue({ success: true })
  net.me.mockReset().mockImplementation(() => new Promise(() => {}))
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); delete document.documentElement.dataset.theme })

it.each(['unknown', 'viewer', 'readOnly', 'view_only', 'staff-no-key', 'read-proxy'])('%sへ変わると欄・札の×・作成入口を止め、復帰後だけ保存できる', async kind => {
  render(<QuickCreate accountId="account-a" {...callbacks} />); fill()
  restrict(kind)
  expect(input().disabled).toBe(true); expect(reply().disabled).toBe(true)
  const remove = screen.getByRole('button', { name: '「営業時間」を外す' }) as HTMLButtonElement
  expect(remove.disabled).toBe(true)
  fireEvent.click(remove)
  fireEvent.change(reply(), { target: { value: '消してはいけない' } })
  fireEvent.change(input(), { target: { value: '足してはいけない' } })
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(reply().value).toBe('10時からです')
  expect(screen.getByRole('button', { name: '「営業時間」を外す' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '「足してはいけない」を外す' })).toBeNull()
  expect(document.querySelector('a[href="/auto-replies/edit"]')).toBeNull()
  if (kind === 'unknown') {
    expect(saveButton().disabled).toBe(true)
    expect(document.querySelector('[data-permission-locked], [data-read-only-notice]')).toBeNull()
  } else {
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(saveButton().hasAttribute('data-permission-locked')).toBe(true)
    expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  }
  await clickSave()
  expect(net.createDraft).not.toHaveBeenCalled(); expect(net.saveDraft).not.toHaveBeenCalled()
  expect(net.conflicts).not.toHaveBeenCalled(); expect(net.publishDraft).not.toHaveBeenCalled()
  verifiedStaffRole('owner'); act(() => rememberSessionSnapshot(proxy('write')))
  await clickSave()
  expect(net.createDraft).toHaveBeenCalledTimes(1); expect(net.conflicts).toHaveBeenCalledTimes(1); expect(net.publishDraft).toHaveBeenCalledTimes(1)
  expect(callbacks.onCreated).toHaveBeenCalledTimes(1)
})

it.each(['owner', 'admin', 'staff'] as const)('%sの正規編集では内容・下書き番号・公開キーを保つ', async role => {
  verifiedStaffRole(role)
  if (role === 'staff') act(() => rememberStaffIdentity({ ...readStaffIdentity()!, permissionKeys: [DELIVERY_FEATURE_POLICIES.autoReplies.key, deliveryPermissionKey('autoReplies', 'edit')] }))
  render(<QuickCreate accountId="account-a" {...callbacks} />); fill(); await clickSave()
  expect(net.createDraft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lineAccountId: 'account-a', responseContent: '10時からです', keyword: '営業時間' }), expect.any(String))
  expect(net.publishDraft).toHaveBeenCalledExactlyOnceWith('draft', { acknowledgedConflictIds: [] }, expect.any(String))
  expect(callbacks.onCreated).toHaveBeenCalledTimes(1)
})

it('下書き作成を待つ間のread切替で確認・公開を送らず、作成済み下書きは復帰後に再利用する', async () => {
  let release!: (value: typeof made) => void
  net.createDraft.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  render(<QuickCreate accountId="account-a" {...callbacks} />); fill()
  act(() => { fireEvent.click(saveButton()) })
  restrict('read-proxy'); await act(async () => { release(made) })
  expect(net.createDraft).toHaveBeenCalledTimes(1); expect(net.conflicts).not.toHaveBeenCalled(); expect(net.publishDraft).not.toHaveBeenCalled()
  expect(callbacks.onCreated).not.toHaveBeenCalled()
  act(() => rememberSessionSnapshot(proxy('write'))); await clickSave()
  expect(net.createDraft).toHaveBeenCalledTimes(1); expect(net.conflicts).toHaveBeenCalledTimes(1); expect(net.publishDraft).toHaveBeenCalledTimes(1)
})

it('更新を待つ間にreadへ変わったら保存済みの番号を保ち、戻ってから重なりを確認し直す', async () => {
  net.conflicts.mockResolvedValue({ success: true, data: { conflicts: [overlap] } })
  render(<QuickCreate accountId="account-a" {...callbacks} />); fill(); await clickSave()
  let release!: (value: { success: boolean; data: { versionNumber: number } }) => void
  net.saveDraft.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  fireEvent.change(reply(), { target: { value: '11時からです' } })
  act(() => { fireEvent.click(saveButton()) })
  restrict('read-proxy'); await act(async () => { release({ success: true, data: { versionNumber: 2 } }) })
  expect(net.conflicts).toHaveBeenCalledTimes(1); expect(net.publishDraft).not.toHaveBeenCalled()
  act(() => rememberSessionSnapshot(proxy('write'))); await clickSave()
  expect(net.saveDraft).toHaveBeenCalledTimes(1); expect(net.conflicts).toHaveBeenCalledTimes(2); expect(net.publishDraft).not.toHaveBeenCalled()
  await clickSave(); expect(net.publishDraft).toHaveBeenCalledTimes(1)
})

it('確認待ち中にreadからwriteへ戻しても古い確認結果で自動公開しない', async () => {
  let release!: (value: { success: boolean; data: { conflicts: [] } }) => void
  net.conflicts.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  render(<QuickCreate accountId="account-a" {...callbacks} />); fill()
  act(() => { fireEvent.click(saveButton()) })
  await waitFor(() => expect(net.conflicts).toHaveBeenCalledTimes(1))
  act(() => { rememberSessionSnapshot(proxy('read')); rememberSessionSnapshot(proxy('write')) })
  await act(async () => { release({ success: true, data: { conflicts: [] } }) })
  expect(net.publishDraft).not.toHaveBeenCalled(); expect(callbacks.onCreated).not.toHaveBeenCalled()
  await clickSave(); expect(net.conflicts).toHaveBeenCalledTimes(2); expect(net.publishDraft).toHaveBeenCalledTimes(1)
})

it('アカウントを往復しても古い確認結果で公開せず、改めて保存すると現在の内容を確認する', async () => {
  let release!: (value: { success: boolean; data: { conflicts: [] } }) => void
  net.conflicts.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const view = render(<QuickCreate accountId="account-a" {...callbacks} />); fill()
  act(() => { fireEvent.click(saveButton()) }); await waitFor(() => expect(net.conflicts).toHaveBeenCalledTimes(1))
  view.rerender(<QuickCreate accountId="account-b" {...callbacks} />)
  expect(input().disabled).toBe(true)
  view.rerender(<QuickCreate accountId="account-a" {...callbacks} />)
  await act(async () => { release({ success: true, data: { conflicts: [] } }) })
  expect(net.publishDraft).not.toHaveBeenCalled()
  await clickSave(); expect(net.conflicts).toHaveBeenCalledTimes(2); expect(net.publishDraft).toHaveBeenCalledTimes(1)
})

it('閉じた後に届いた確認結果で公開や成功通知をしない', async () => {
  let release!: (value: { success: boolean; data: { conflicts: [] } }) => void
  net.conflicts.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const view = render(<QuickCreate accountId="account-a" {...callbacks} />); fill()
  act(() => { fireEvent.click(saveButton()) }); await waitFor(() => expect(net.conflicts).toHaveBeenCalledTimes(1))
  view.unmount(); await act(async () => { release({ success: true, data: { conflicts: [] } }) })
  expect(net.publishDraft).not.toHaveBeenCalled(); expect(callbacks.onCreated).not.toHaveBeenCalled()
})

it('既存の重なりを承認した後に権限が変わると、復帰後にも承認を取り直す', async () => {
  net.conflicts.mockResolvedValue({ success: true, data: { conflicts: [overlap] } })
  render(<QuickCreate accountId="account-a" {...callbacks} />); fill(); await clickSave()
  expect(net.publishDraft).not.toHaveBeenCalled()
  act(() => { rememberSessionSnapshot(proxy('read')); rememberSessionSnapshot(proxy('write')) })
  await clickSave(); expect(net.publishDraft).not.toHaveBeenCalled()
  await clickSave(); expect(net.publishDraft).toHaveBeenCalledTimes(1)
})
