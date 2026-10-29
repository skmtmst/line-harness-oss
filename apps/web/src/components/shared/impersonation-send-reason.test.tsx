// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import type { StaffMember } from '@line-crm/shared'
import Button from './button'
import { lockMenuItems, lockReason, lockUnless, permissionLockReason, PERMISSION_LOCK_REASON, PERMISSION_LOCK_SUMMARY } from './permission-lock'
const text = '代理ログイン中は配信をすぐには送れません。代理ログインを終了してから送ってください。'
const owner = { id: 'owner-a', role: 'owner', name: 'オーナー', permissionKeys: [] } as unknown as StaffMember
function proxy(mode: 'read' | 'write') {
  rememberSessionSnapshot({ impersonation: { id: 'proxy-a', tenantId: 'tenant-a', mode, piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'totp' })
}
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })
it('直接送信の明示理由だけを新しい文とし、許可時と既定の理由を変えない', () => {
  expect(PERMISSION_LOCK_REASON.impersonationSend).toBe(text)
  expect(PERMISSION_LOCK_SUMMARY.impersonationSend).toBe(text)
  expect(permissionLockReason('owner', false, 'impersonationSend')).toBe(text)
  expect(permissionLockReason('owner', true, 'impersonationSend')).toBeUndefined()
  expect(permissionLockReason('viewer', false, 'impersonationSend')).toBe(PERMISSION_LOCK_REASON.viewer)
  expect(permissionLockReason(null, false)).toBe(PERMISSION_LOCK_REASON.feature)
  rememberStaffIdentity(owner)
  expect(lockReason(true)).toBeUndefined()
  expect(lockReason(false, 'manager')).toBe(PERMISSION_LOCK_REASON.manager)
})
it.each(['read', 'write'] as const)('%s代理でも新しい理由を明示した送信口だけが止まり、通常の理由の優先は変わらない', mode => {
  rememberStaffIdentity(owner); proxy(mode)
  const send = vi.fn(), edit = vi.fn()
  render(<><Button lockedReason={PERMISSION_LOCK_REASON.impersonationSend} onClick={send}>すぐ送る</Button><Button onClick={edit}>通常の口</Button></>)
  const button = screen.getByRole('button', { name: 'すぐ送る' }) as HTMLButtonElement
  expect(button.disabled).toBe(false); expect(button.getAttribute('aria-disabled')).toBe('true'); expect(button.tabIndex).toBe(0)
  fireEvent.focus(button); expect(screen.getByRole('tooltip').textContent).toContain(text)
  fireEvent.click(button); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.keyDown(button, { key: ' ' })
  expect(send).not.toHaveBeenCalled()
  const normal = screen.getByRole('button', { name: '通常の口' }) as HTMLButtonElement
  expect(normal.disabled).toBe(false); expect(normal.hasAttribute('data-permission-locked')).toBe(false)
  fireEvent.click(normal); expect(edit).toHaveBeenCalledTimes(1)
  expect(lockReason(true)).toBe(mode === 'read' ? PERMISSION_LOCK_REASON.impersonation : undefined)
  expect(lockUnless(true, 'manager')).toBe(mode === 'read' ? PERMISSION_LOCK_REASON.impersonation : undefined)
  const read = { id: 'csv', label: 'CSVを見る', href: '/broadcasts' }
  const write = { id: 'edit', label: '編集する' }
  const items = [read, write], result = lockMenuItems(true, items, 'feature', item => item.id === 'csv')
  expect(result[0]).toBe(read)
  expect(result[1]).toEqual(mode === 'read' ? { ...write, lockedReason: PERMISSION_LOCK_REASON.impersonation } : write)
})
