'use client'

import { useSyncExternalStore } from 'react'
import { lockReason } from '@/components/shared/permission-lock'
import { useStaffIdentity } from '@/lib/staff-role'
import { effectiveStaffRole, readStaffIdentity, staffIdentityGeneration } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'

export function canManageWebhooksNow(ownerOnly = false): boolean {
  if (readPermissionSessionSnapshot()?.impersonation?.mode === 'read') return false
  const role = effectiveStaffRole(readStaffIdentity())
  return role === 'owner' || (!ownerOnly && role === 'admin')
}

/** 本人や代理モードが途中で変わった操作は、権限が戻っても再開しない。 */
export function captureWebhookWriteAccess(ownerOnly = false): () => boolean {
  const identity = readStaffIdentity()
  const generation = staffIdentityGeneration()
  const session = readPermissionSessionSnapshot()
  return () => identity === readStaffIdentity() && generation === staffIdentityGeneration()
    && session === readPermissionSessionSnapshot() && canManageWebhooksNow(ownerOnly)
}

const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}

export function useWebhookWriteAccess(ownerOnly = false) {
  const identity = useStaffIdentity()
  useSyncExternalStore(subscribeSession, readPermissionSessionSnapshot, () => null)
  const allowed = canManageWebhooksNow(ownerOnly)
  return { allowed, known: identity !== null, reason: identity ? lockReason(allowed, ownerOnly ? 'owner' : 'manager') : undefined }
}
