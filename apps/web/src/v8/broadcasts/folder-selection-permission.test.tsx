// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import type { ComponentProps } from 'react'
const net = vi.hoisted(() => ({ update: vi.fn(), reload: vi.fn(), toast: vi.fn() }))
const picker = vi.hoisted(() => ({ confirm: null as null | ((id: string) => void) }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: net.toast }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, broadcasts: { ...actual.api.broadcasts, update: net.update } } }
})
vi.mock('@/components/shared/entity-picker', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/shared/entity-picker')>()
  return { ...original, EntityPickerDialog: (props: ComponentProps<typeof original.EntityPickerDialog>) => {
    picker.confirm = props.onConfirm as (id: string) => void
    return <original.EntityPickerDialog {...props} />
  } }
})
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { PERMISSION_LOCK_REASON } from '@/components/shared/permission-lock'
import { useBroadcastFolderSelection } from './folder-selection'
import type { ApiBroadcast } from '@/lib/api'
const row = { id: 'one', title: '配信A', version: 7, status: 'draft' } as ApiBroadcast
const folders = [{ id: 'f', name: '分類A', kind: 'broadcast' as const, color: null }]
const owner = { id: 'owner-a', role: 'owner', name: 'オーナー', permissionKeys: [] } as unknown as StaffMember
function person(role: string, permissionKeys: string[] = []) { return { id: 'person-a', role, name: '本人', permissionKeys } as unknown as StaffMember }
function proxy(mode: 'read' | 'write') {
  rememberSessionSnapshot({ unfamiliarAt: null, stepUpMethod: 'totp', impersonation: { mode, startedAt: '2026-10-01T00:00:00Z' } } as Parameters<typeof rememberSessionSnapshot>[0])
}
function Harness({ canEdit = true, lockedReason }: { canEdit?: boolean; lockedReason?: string }) {
  const selection = useBroadcastFolderSelection({ accountId: 'account-a', canEdit, lockedReason, broadcasts: [row], folders, onChanged: net.reload })
  return <>{selection.pageCheckbox}{selection.checkbox(row)}{selection.overlays}</>
}
function open() {
  fireEvent.click(screen.getByLabelText('配信Aを選ぶ'))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダへ移す' }))
  fireEvent.click(screen.getByRole('radio', { name: '分類A' }))
}
function save() { return within(screen.getByRole('dialog')).getByRole('button', { name: 'フォルダへ移す' }) }
beforeEach(() => {
  forgetStaffIdentity(); forgetSessionSnapshot(); rememberStaffIdentity(owner)
  net.update.mockReset().mockResolvedValue({ success: true }); net.reload.mockReset().mockResolvedValue(undefined); net.toast.mockReset(); picker.confirm = null
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })
it.each(['owner', 'admin', 'staff'])('%sの正規編集者は同じ選ぶ窓からversion付きで1回移せる', async role => {
  rememberStaffIdentity(person(role, ['/broadcasts', 'broadcast.definition.edit']))
  render(<Harness />); open(); fireEvent.click(save())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.update).toHaveBeenCalledExactlyOnceWith('one', { folderId: 'f', expectedVersion: 7 })
  expect(net.reload).toHaveBeenCalledTimes(1)
})
it('窓を残したread代理切替は灰色の理由を示し、古い確定でも送らない', async () => {
  const view = render(<Harness />); open()
  const dialog = screen.getByRole('dialog'), retained = picker.confirm!
  expect(retained).toBeTypeOf('function')
  proxy('read'); view.rerender(<Harness canEdit={false} lockedReason={PERMISSION_LOCK_REASON.impersonation} />)
  expect(screen.getByRole('dialog')).toBe(dialog)
  const confirm = save() as HTMLButtonElement
  expect(confirm.disabled).toBe(false); expect(confirm.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(confirm); expect(screen.getByRole('tooltip').textContent).toContain(PERMISSION_LOCK_REASON.impersonation)
  fireEvent.click(confirm)
  await act(async () => retained('f'))
  expect(net.update).not.toHaveBeenCalled()
  expect(dialog.textContent).toContain('権限が変わったため、フォルダへの移動を中止しました。')
})
it('readからwriteへ戻っても古い操作を再開せず、理由を出して新しい明示再試行だけを通す', async () => {
  const view = render(<Harness />); open()
  const retained = picker.confirm!
  proxy('read'); proxy('write')
  await act(async () => retained('f'))
  expect(net.update).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog').textContent).toContain('1件を移せませんでした。権限が変わったため')
  expect(net.reload).toHaveBeenCalledTimes(1)
  view.rerender(<Harness />)
  expect(net.update).not.toHaveBeenCalled()
  fireEvent.click(save())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.update).toHaveBeenCalledExactlyOnceWith('one', { folderId: 'f', expectedVersion: 7 })
})
it('同じ本人オブジェクトでも再確認の世代が変われば保持した移動を送らない', async () => {
  render(<Harness />); open()
  const retained = picker.confirm!
  forgetStaffIdentity(); rememberStaffIdentity(owner)
  await act(async () => retained('f'))
  expect(net.update).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog').textContent).toContain('権限が変わったため')
})
it('本人が未確認でも欄は残し、理由なしdisabledで送らない', () => {
  forgetStaffIdentity()
  render(<Harness canEdit={false} />)
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  for (const input of screen.getAllByRole('checkbox')) {
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect(input.hasAttribute('data-permission-locked')).toBe(false)
    fireEvent.click(input)
  }
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(net.update).not.toHaveBeenCalled()
})
