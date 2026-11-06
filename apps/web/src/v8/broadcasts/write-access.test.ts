// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import type { ApiBroadcast } from '@/lib/api'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { canChangeBroadcastNow, canEditBroadcastNow, canManageBroadcastListNow, captureBroadcastWriteAccess } from './write-access'

const item = { id: 'broadcast', fromHeadquarters: false } as unknown as ApiBroadcast
const identity = (role: string, extra: object = {}) => ({ id: 'person', role, permissionKeys: [], ...extra }) as unknown as StaffMember
const mode = (value: 'read' | 'write') => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: value } as never })
beforeEach(() => { forgetStaffIdentity(); forgetSessionSnapshot() })
afterEach(() => { forgetStaffIdentity(); forgetSessionSnapshot() })

it.each(['owner', 'admin'])('%sは定義変更と検索・フォルダ管理を許可する', role => {
  rememberStaffIdentity(identity(role))
  expect(canEditBroadcastNow()).toBe(true)
  expect(canManageBroadcastListNow()).toBe(true)
  expect(canChangeBroadcastNow(item)).toBe(true)
})

it('担当者の定義編集鍵では定義変更だけを許し、検索・フォルダ管理へ広げない', () => {
  rememberStaffIdentity(identity('staff', { permissionKeys: ['/broadcasts', 'broadcast.definition.edit'] }))
  expect(canEditBroadcastNow()).toBe(true)
  expect(canManageBroadcastListNow()).toBe(false)
  expect(canChangeBroadcastNow(item)).toBe(true)
})

it.each([[], ['/broadcasts'], ['/broadcasts', 'broadcast.definition.publish'], ['broadcast.definition.edit']].map(permissionKeys => ({ permissionKeys })))('編集鍵と機能鍵の不足 %j では定義を書き換えない', ({ permissionKeys }) => {
  expect(Array.isArray(permissionKeys)).toBe(true)
  rememberStaffIdentity(identity('staff', { permissionKeys }))
  expect(canEditBroadcastNow()).toBe(false)
  expect(canChangeBroadcastNow(item)).toBe(false)
})

it.each([identity('viewer'), identity('staff'), identity('owner', { readOnly: true }), identity('admin', { roleBundle: 'view_only' }), null])('閲覧・鍵なし・本人不明ではすべての変更を拒む %j', person => {
  if (person) rememberStaffIdentity(person)
  expect(canEditBroadcastNow()).toBe(false)
  expect(canManageBroadcastListNow()).toBe(false)
  expect(canChangeBroadcastNow(item)).toBe(false)
})

it('read代理のownerは拒み、writeへ戻した後の明示操作だけを許可する', () => {
  rememberStaffIdentity(identity('owner')); mode('read')
  expect(canEditBroadcastNow()).toBe(false)
  expect(canManageBroadcastListNow()).toBe(false)
  mode('write')
  expect(canEditBroadcastNow()).toBe(true)
  expect(canManageBroadcastListNow()).toBe(true)
})

it('店から統括の配信の定義を変更しない。閲覧・複製の許可とは分ける', () => {
  rememberStaffIdentity(identity('owner'))
  expect(canChangeBroadcastNow({ ...item, fromHeadquarters: true } as ApiBroadcast)).toBe(false)
  expect(canEditBroadcastNow()).toBe(true)
})

it.each(['read', 'read-write', 'identity'] as const)('保持した処理は%sへの推移で失効し、戻っても再開しない', change => {
  const owner = identity('owner'); rememberStaffIdentity(owner)
  const retained = captureBroadcastWriteAccess()
  expect(retained(item)).toBe(true)
  if (change === 'identity') { forgetStaffIdentity(); rememberStaffIdentity(owner) }
  else { mode('read'); if (change === 'read-write') mode('write') }
  expect(retained(item)).toBe(false)
  if (change !== 'read') expect(captureBroadcastWriteAccess()(item)).toBe(true)
})


it('forgetを挟まない別の本人への差替でも保持した操作を失効させ、新しい明示操作は通す', () => {
  rememberStaffIdentity(identity('owner', { id: 'first' }))
  const retained = captureBroadcastWriteAccess()
  expect(retained(item)).toBe(true)
  rememberStaffIdentity(identity('owner', { id: 'second' }))
  expect(canChangeBroadcastNow(item)).toBe(true)
  expect(retained(item)).toBe(false)
  expect(captureBroadcastWriteAccess()(item)).toBe(true)
})
