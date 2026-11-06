'use client'

import { useEffect, useRef } from 'react'
import { useStaffIdentity } from '@/lib/staff-role'
import { effectiveStaffRole, readStaffIdentity, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import { usePermissionLockReason } from '@/components/shared/use-permission-lock-reason'

/** 本人APIの役割・専用鍵と代理モードを、保持された操作も実行直前に読む。 */
function canControlNow(accountId: string): boolean {
  const identity = readStaffIdentity(), role = effectiveStaffRole(identity)
  if (readPermissionSessionSnapshot()?.impersonation?.mode === 'read') return false
  if (role === 'owner') return true
  return role === 'admin' && accountId !== 'all'
    && identity?.permissionKeys?.includes('operations.control.execute') === true
}

export function useEmergencyControlAccess({ ready, permitted, accountId }: {
  ready: boolean; permitted: boolean; accountId: string
}) {
  const identity = useStaffIdentity()
  const current = useRef({ ready, permitted, accountId })
  const epoch = useRef(0), mounted = useRef(false)
  if (current.current.accountId !== accountId || current.current.ready !== ready || current.current.permitted !== permitted) epoch.current++
  current.current = { ready, permitted, accountId }
  const allowed = ready && permitted && canControlNow(accountId)
  const resolvedReason = usePermissionLockReason(allowed, accountId === 'all' && effectiveStaffRole(identity) === 'admin' ? 'owner' : 'feature')
  // 読込失敗や本人未確認を、権限不足という説明へ変えない。
  const lockedReason = (ready || !canControlNow(accountId)) && effectiveStaffRole(identity) !== null ? resolvedReason : undefined
  const invalidate = () => { epoch.current++ }
  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeStaffIdentity(invalidate)
    window.addEventListener(SESSION_SNAPSHOT_CHANGED, invalidate)
    return () => {
      mounted.current = false
      invalidate(); unsubscribe()
      window.removeEventListener(SESSION_SNAPSHOT_CHANGED, invalidate)
    }
  }, [])
  const canRun = () => current.current.ready && current.current.permitted && canControlNow(current.current.accountId)
  const capture = () => {
    const requestedEpoch = epoch.current
    return () => mounted.current && requestedEpoch === epoch.current && canRun()
  }
  return { allowed, lockedReason, canRun, capture, invalidate }
}
