// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { deferImpersonationSnapshot, forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { canWriteScenarioNow, captureScenarioWriteAccess, useScenarioWriteAccess } from './write-access'

const identity = (role: string, extra: object = {}) => ({ id: 'person', role, permissionKeys: [], ...extra }) as unknown as StaffMember
const mode = (value: 'read' | 'write') => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: value } as never })
beforeEach(() => { forgetStaffIdentity(); forgetSessionSnapshot() })
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })

it.each(['owner', 'admin'])('%sは定義・開始停止・フォルダ管理を許可する', role => {
  rememberStaffIdentity(identity(role))
  for (const operation of ['edit', 'publish', 'manageFolders'] as const) expect(canWriteScenarioNow(operation)).toBe(true)
})

it('編集キーstaffは定義だけ変更できる。publishキーを足しても開始停止と管理へ広げない', () => {
  rememberStaffIdentity(identity('staff', { permissionKeys: ['/scenarios', 'scenario.definition.edit', 'scenario.definition.publish'] }))
  expect(canWriteScenarioNow()).toBe(true)
  expect(canWriteScenarioNow('publish')).toBe(false)
  expect(canWriteScenarioNow('manageFolders')).toBe(false)
})

it.each([[], ['/scenarios'], ['/scenarios', 'scenario.definition.publish'], ['scenario.definition.edit']].map(permissionKeys => ({ permissionKeys })))('鍵の不足%jで定義を書き換えない', ({ permissionKeys }) => {
  rememberStaffIdentity(identity('staff', { permissionKeys }))
  expect(canWriteScenarioNow()).toBe(false)
})

it.each([identity('viewer'), identity('staff'), identity('owner', { readOnly: true }), identity('admin', { roleBundle: 'view_only' }), null])('閲覧・本人不明%jでは書込だけを拒む', person => {
  if (person) rememberStaffIdentity(person)
  for (const operation of ['edit', 'publish', 'manageFolders'] as const) expect(canWriteScenarioNow(operation)).toBe(false)
})

it('read代理はownerでも拒否し、writeへの切替後の明示操作だけを許す', () => {
  rememberStaffIdentity(identity('owner')); mode('read')
  for (const operation of ['edit', 'publish', 'manageFolders'] as const) expect(canWriteScenarioNow(operation)).toBe(false)
  mode('write')
  for (const operation of ['edit', 'publish', 'manageFolders'] as const) expect(canWriteScenarioNow(operation)).toBe(true)
})

it.each(['read', 'read-write', 'read-null', 'identity', 'replacement'] as const)('保持した処理は%sで失効し、許可が戻っても再開しない', change => {
  const owner = identity('owner'); rememberStaffIdentity(owner)
  const retained = captureScenarioWriteAccess()
  expect(retained()).toBe(true)
  if (change === 'identity') { forgetStaffIdentity(); rememberStaffIdentity(owner) }
  else if (change === 'replacement') rememberStaffIdentity(identity('owner', { id: 'different' }))
  else { mode('read'); if (change === 'read-write') mode('write'); else if (change === 'read-null') forgetSessionSnapshot() }
  expect(retained()).toBe(false)
  if (change !== 'read') expect(captureScenarioWriteAccess()()).toBe(true)
})

it('表示も未知・閲覧・編集staff・read代理への切替を購読して同じ条件へ追従する', () => {
  const { result } = renderHook(() => useScenarioWriteAccess())
  expect(result.current).toEqual({ allowed: false, known: false, reason: undefined })
  act(() => rememberStaffIdentity(identity('viewer')))
  expect(result.current.allowed).toBe(false)
  expect(result.current.known).toBe(true)
  expect(result.current.reason).toBeTruthy()
  act(() => rememberStaffIdentity(identity('staff', { permissionKeys: ['/scenarios', 'scenario.definition.edit'] })))
  expect(result.current).toEqual({ allowed: true, known: true, reason: undefined })
  act(() => mode('read'))
  expect(result.current.allowed).toBe(false)
  expect(result.current.reason).toContain('代理')
  act(() => forgetStaffIdentity())
  expect(result.current).toEqual({ allowed: false, known: false, reason: undefined })
})

it('代理切替の認証読直し中もreadへ倒し、役割ownerを理由に許可せず代理の共通理由を出す', () => {
  rememberStaffIdentity(identity('owner'))
  const held = captureScenarioWriteAccess()
  const { result } = renderHook(() => useScenarioWriteAccess())
  expect(held()).toBe(true)
  act(() => { deferImpersonationSnapshot({ mode: 'write', id: 'pending-proxy', tenantId: 'tenant' } as never) })
  expect(result.current.allowed).toBe(false)
  expect(result.current.known).toBe(true)
  expect(result.current.reason).toContain('代理ログイン（閲覧）')
  expect(held()).toBe(false)
  for (const operation of ['edit', 'publish', 'manageFolders'] as const) expect(canWriteScenarioNow(operation)).toBe(false)
})
