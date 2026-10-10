import { useEffect, useSyncExternalStore } from 'react'
import { rememberStaffIdentity, forgetStaffIdentity, readStaffIdentity, subscribeStaffIdentity, staffIdentityGeneration } from './staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
import { SESSION_LOST_EVENT } from './session-events'
import { api } from '@/lib/api'

/** 役割だけで管理者に限定する操作。機能を任されたstaffの操作は別の鍵で判定する。 */
export function canManageRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * ログイン中の担当者の役割。`api.staff.me()` で入り直して読む。
 * 手元の保存値は書き換え可能なので判定に使わない。
 *
 * 確認が終わるまで・読めなかったときは null を返す。呼び出し側は
 * そのあいだ変更操作を隠す。
 * 最後の守りはサーバの 403（失敗時は権限不足の文を出す）。
 */
let pendingIdentity: Promise<void> | null = null
let consumers = 0
const serverIdentity = () => null

export function useStaffIdentity(): StaffMember | null {
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, serverIdentity)
  useEffect(() => {
    consumers++
    const invalidate = () => { pendingIdentity = null; forgetStaffIdentity() }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || ['lh_csrf', 'lh_staff_role'].includes(event.key)) invalidate()
    }
    window.addEventListener(SESSION_LOST_EVENT, invalidate)
    window.addEventListener('storage', onStorage)
    if (!readStaffIdentity() && !pendingIdentity) {
      const generation = staffIdentityGeneration()
      const request = Promise.resolve().then(() => api.staff.me()).then((response) => {
        if (generation !== staffIdentityGeneration() || !response.success) return
        rememberStaffIdentity(response.data)
      }).catch(() => {}).finally(() => {
        if (pendingIdentity === request) pendingIdentity = null
      })
      pendingIdentity = request
    }
    return () => {
      window.removeEventListener(SESSION_LOST_EVENT, invalidate)
      window.removeEventListener('storage', onStorage)
      if (--consumers === 0) invalidate()
    }
  }, [])
  return identity
}

export function useStaffRole(): string | null {
  const identity = useStaffIdentity()
  if (!identity) return null
  return identity.readOnly || identity.roleBundle === 'view_only' ? 'viewer' : identity.role
}

/** 統括のひな形・配信は全社の管理者だけ（APIのaccount_scope判定と同じ）。 */
export function useTenantWideAccess(): boolean {
  const identity = useStaffIdentity()
  return Boolean(identity && canManageRole(identity.role)
    && !identity.readOnly && identity.roleBundle !== 'view_only' && identity.accountScope !== 'accounts')
}
