'use client'

import { useSyncExternalStore } from 'react'
import { effectiveStaffRole, readStaffIdentity, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot as readSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import { PERMISSION_LOCK_REASON, permissionLockReason, type PermissionLockKind } from './permission-lock'

const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}

/** 表示用の理由を本人・代理ログインの変更に追従させる。未知の間の拒否は呼ぶ側のdisabledとhandlerで守る。 */
export function usePermissionLockReason(allowed: boolean, need: Exclude<PermissionLockKind, 'viewer'> = 'feature'): string | undefined {
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, () => null)
  const session = useSyncExternalStore(subscribeSession, readSessionSnapshot, () => null)
  const role = effectiveStaffRole(identity)
  if (role === null) return undefined
  return session?.impersonation?.mode === 'read' ? PERMISSION_LOCK_REASON.impersonation : permissionLockReason(role, allowed, need)
}
