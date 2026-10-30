'use client'

import { useSyncExternalStore } from 'react'
import { lockReason, PERMISSION_LOCK_REASON } from '@/components/shared/permission-lock'
import { BROADCAST_DEFINITION_PUBLISH_KEY, DELIVERY_FEATURE_POLICIES } from '@line-crm/shared'
import { canEditFeature } from '@/lib/staff-capability'
import { effectiveStaffRole, readStaffIdentity, staffIdentityGeneration, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import { canEditBroadcastNow } from './write-access'

export type QuickSendOperation = 'create' | 'preflight' | 'send' | 'approval' | 'schedule'

/** 定義の作成と、人数確認・送信・承認依頼の専用の鍵を分ける。 */
export function canUseQuickSendNow(operation: QuickSendOperation): boolean {
  const session = readPermissionSessionSnapshot()
  if (session?.impersonation?.mode === 'read') return false
  if (operation === 'create') return canEditBroadcastNow()
  const role = effectiveStaffRole(readStaffIdentity())
  const publish = canEditFeature(DELIVERY_FEATURE_POLICIES.broadcasts.key, role)
    && canEditFeature(BROADCAST_DEFINITION_PUBLISH_KEY, role)
  // 直接送信だけは、書込の代理ログインもサーバが拒否する。
  if (operation === 'send') return publish && !session?.impersonation
  // この窓の予約は人数確認を経て新規作成する。既存の予約APIの鍵は変えない。
  if (operation === 'schedule') return publish && canEditBroadcastNow()
  return publish
}

/** 待機中に本人や代理モードが往復しても、元の操作を自動で再開しない。 */
export function captureQuickSendAccess(): (operation: QuickSendOperation) => boolean {
  const identity = readStaffIdentity(), generation = staffIdentityGeneration(), session = readPermissionSessionSnapshot()
  return operation => identity === readStaffIdentity() && generation === staffIdentityGeneration()
    && session === readPermissionSessionSnapshot() && canUseQuickSendNow(operation)
}

const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}
/** 本人と代理モードの更新を、実行時と同じ判定で画面へ伝える。 */
export function useQuickSendAccess() {
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, () => null)
  const session = useSyncExternalStore(subscribeSession, readPermissionSessionSnapshot, () => null)
  return {
    identity, session, known: identity !== null,
    create: canUseQuickSendNow('create'), preflight: canUseQuickSendNow('preflight'),
    reason: (operation?: QuickSendOperation) => {
      if (!identity || !operation || canUseQuickSendNow(operation)) return undefined
      if (operation === 'send' && session?.impersonation) return PERMISSION_LOCK_REASON.impersonationSend
      return lockReason(false, 'feature')
    },
  }
}
