import type { StaffMember } from '@line-crm/shared'
import { invalidateApiReads } from './api/transport/read-cache'

// 保存値ではなく、本人APIで確かめた役割と鍵だけを使う。
let identity: StaffMember | null = null
let generation = 0
const listeners = new Set<() => void>()
export function rememberStaffIdentity(value: StaffMember): void {
  identity = value
  for (const listener of listeners) listener()
}
export function forgetStaffIdentity(): void {
  invalidateApiReads('/api/staff/me')
  generation++
  identity = null
  for (const listener of listeners) listener()
}
export function readStaffIdentity(): StaffMember | null { return identity }
/** 読み取り専用の束は役割の表示名より優先する。 */
export function effectiveStaffRole(identity: Pick<StaffMember, 'role' | 'readOnly' | 'roleBundle'> | null): StaffMember['role'] | null {
  return identity ? identity.readOnly || identity.roleBundle === 'view_only' ? 'viewer' : identity.role : null
}
export function staffIdentityGeneration(): number { return generation }
export function subscribeStaffIdentity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
