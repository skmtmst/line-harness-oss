'use client'

import { useSyncExternalStore } from 'react'
import { lockReason, PERMISSION_LOCK_REASON } from '@/components/shared/permission-lock'
import { useStaffRole } from '@/lib/staff-role'
import { effectiveStaffRole, readStaffIdentity, staffIdentityGeneration } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import { mcpPermissions } from './words'

export function currentMcpPermissions() {
  return mcpPermissions(effectiveStaffRole(readStaffIdentity()), Boolean(readPermissionSessionSnapshot()?.impersonation))
}

export function captureMcpCreation() {
  const identity = readStaffIdentity()
  const generation = staffIdentityGeneration()
  const session = readPermissionSessionSnapshot()
  return () => identity === readStaffIdentity() && generation === staffIdentityGeneration()
    && session === readPermissionSessionSnapshot() && currentMcpPermissions().create
}

const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}

export function useMcpPermissions() {
  const role = useStaffRole()
  const session = useSyncExternalStore(subscribeSession, readPermissionSessionSnapshot, () => null)
  const permissions = mcpPermissions(role, Boolean(session?.impersonation))
  const reason = role === null || permissions.create ? undefined
    : session?.impersonation ? PERMISSION_LOCK_REASON.owner : lockReason(false, 'owner')
  return { ...permissions, reason }
}
