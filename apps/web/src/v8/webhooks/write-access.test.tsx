// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, expect, it } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { rememberStaffIdentity, readStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { canManageWebhooksNow, captureWebhookWriteAccess } from './write-access'

afterEach(() => { verifiedStaffRole(null); forgetSessionSnapshot() })
it('通常の定義は管理者にも、鍵と削除はオーナーだけに許可する', () => {
  for (const role of ['owner', 'admin', 'staff', 'viewer', null] as const) {
    verifiedStaffRole(role)
    expect(canManageWebhooksNow()).toBe(role === 'owner' || role === 'admin')
    expect(canManageWebhooksNow(true)).toBe(role === 'owner')
  }
})
it('閲覧のみの束とread代理では、オーナーでも書き込まない', () => {
  verifiedStaffRole('owner')
  act(() => rememberStaffIdentity({ ...readStaffIdentity()!, readOnly: true }))
  expect(canManageWebhooksNow()).toBe(false)
  verifiedStaffRole('owner')
  act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null,
    impersonation: { id: 'proxy', tenantId: 'tenant', mode: 'read', piiRevealed: false, startedAt: '' } }))
  expect(canManageWebhooksNow()).toBe(false)
  expect(canManageWebhooksNow(true)).toBe(false)
})
it('本人が切り替わった古い確認は、元の役割へ戻っても再開しない', () => {
  verifiedStaffRole('admin')
  const current = captureWebhookWriteAccess()
  expect(current()).toBe(true)
  verifiedStaffRole('viewer')
  expect(current()).toBe(false)
  verifiedStaffRole('admin')
  expect(canManageWebhooksNow()).toBe(true)
  expect(current()).toBe(false)
})
it('代理モードを切り替えた古い鍵の確認は再開しない', () => {
  verifiedStaffRole('owner')
  const current = captureWebhookWriteAccess(true)
  act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null,
    impersonation: { id: 'proxy', tenantId: 'tenant', mode: 'write', piiRevealed: false, startedAt: '' } }))
  expect(canManageWebhooksNow(true)).toBe(true)
  expect(current()).toBe(false)
})
