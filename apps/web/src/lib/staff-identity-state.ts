import type { StaffMember } from '@line-crm/shared'

// 保存値ではなく、本人APIで確かめた役割と鍵だけを使う。
let identity: StaffMember | null = null
let generation = 0
const listeners = new Set<() => void>()
export function rememberStaffIdentity(value: StaffMember): void {
  identity = value
  for (const listener of listeners) listener()
}
export function forgetStaffIdentity(): void {
  generation++
  identity = null
  for (const listener of listeners) listener()
}
export function readStaffIdentity(): StaffMember | null { return identity }
export function staffIdentityGeneration(): number { return generation }
export function subscribeStaffIdentity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
