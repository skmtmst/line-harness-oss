'use client'

import { useSyncExternalStore } from 'react'
import { lockReason } from '@/components/shared/permission-lock'
import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import type { ApiBroadcast } from '@/lib/api'
import { canEditFeature } from '@/lib/staff-capability'
import { effectiveStaffRole, readStaffIdentity, staffIdentityGeneration, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'

/** 保持した操作でも、本人APIの控えと現在の代理モードを実行直前に読む。 */
export function canEditBroadcastNow(): boolean {
  if (readPermissionSessionSnapshot()?.impersonation?.mode === 'read') return false
  const role = effectiveStaffRole(readStaffIdentity())
  return canEditFeature(DELIVERY_FEATURE_POLICIES.broadcasts.key, role)
    && canEditFeature(deliveryPermissionKey('broadcasts', 'edit'), role)
}

/** 保存した検索とフォルダの管理は、配信の編集鍵とは別にowner/adminが必要。 */
export function canManageBroadcastListNow(): boolean {
  if (readPermissionSessionSnapshot()?.impersonation?.mode === 'read') return false
  const role = effectiveStaffRole(readStaffIdentity())
  return role === 'owner' || role === 'admin'
}

/** 統括から来た配信は店で変更できない。閲覧と複製の可否には使わない。 */
export function isFromHeadquarters(broadcast: ApiBroadcast): boolean {
  return (broadcast as ApiBroadcast & { fromHeadquarters?: boolean }).fromHeadquarters === true
}

export function canChangeBroadcastNow(broadcast: ApiBroadcast): boolean {
  return !isFromHeadquarters(broadcast) && canEditBroadcastNow()
}

/** 待機中・まとめ処理中に本人や代理モードが変わった操作は、元に戻っても自動再開しない。 */
export function captureBroadcastWriteAccess(): (broadcast: ApiBroadcast) => boolean {
  const identity = readStaffIdentity()
  const generation = staffIdentityGeneration()
  const session = readPermissionSessionSnapshot()
  return broadcast => identity === readStaffIdentity() && generation === staffIdentityGeneration() && session === readPermissionSessionSnapshot()
    && canChangeBroadcastNow(broadcast)
}

const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}
/** 描画も実行直前の守りと同じ本人・代理モードに追従する。ここでは読み込みを起こさない。 */
export function useBroadcastManagementAccess() {
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, () => null)
  useSyncExternalStore(subscribeSession, readPermissionSessionSnapshot, () => null)
  const allowed = canManageBroadcastListNow()
  return { allowed, known: identity !== null, reason: identity ? lockReason(allowed, 'manager') : undefined }
}

/** 本人と代理モードに従い、定義の変更口の表示を現在の実行条件にそろえる。 */
export function useBroadcastEditAccess() {
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, () => null)
  useSyncExternalStore(subscribeSession, readPermissionSessionSnapshot, () => null)
  const allowed = canEditBroadcastNow()
  return { allowed, known: identity !== null, reason: identity ? lockReason(allowed, 'feature') : undefined }
}
