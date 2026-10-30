'use client'

import { useSyncExternalStore } from 'react'
import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import { lockReason } from '@/components/shared/permission-lock'
import { canEditFeature } from '@/lib/staff-capability'
import { effectiveStaffRole, readStaffIdentity, staffIdentityGeneration, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import { readPermissionSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'

export type ScenarioWriteOperation = 'edit' | 'publish' | 'manageFolders'

/** 表示時の役割だけに頼らず、保存の直前に本人と代理モードを読む。 */
export function canWriteScenarioNow(operation: ScenarioWriteOperation = 'edit'): boolean {
  if (readPermissionSessionSnapshot()?.impersonation?.mode === 'read') return false
  const role = effectiveStaffRole(readStaffIdentity())
  if (operation === 'manageFolders') return role === 'owner' || role === 'admin'
  const definition = canEditFeature(DELIVERY_FEATURE_POLICIES.scenarios.key, role)
    && canEditFeature(deliveryPermissionKey('scenarios', 'edit'), role)
  if (!definition) return false
  // 開始も停止もAPIがpublishを要求し、シナリオのpublishは管理者だけ。
  return operation === 'edit' || role === 'owner' || role === 'admin'
}

// 同じnullや同じsnapshotへ戻っても、途中の切替で失効した処理は復活させない。
const sessionVersions = new WeakMap<Window, { value: number }>()
const sessionVersion = () => {
  if (typeof window === 'undefined') return 0
  let version = sessionVersions.get(window)
  if (!version) {
    version = { value: 0 }
    sessionVersions.set(window, version)
    const current = version
    window.addEventListener(SESSION_SNAPSHOT_CHANGED, () => { current.value++ })
  }
  return version.value
}

/** 途中で本人・セッションが替わった処理は、許可が戻っても勝手に継続しない。 */
export function captureScenarioWriteAccess(operation: ScenarioWriteOperation = 'edit'): () => boolean {
  const identity = readStaffIdentity()
  const generation = staffIdentityGeneration()
  const session = readPermissionSessionSnapshot()
  const sessionGeneration = sessionVersion()
  return () => identity === readStaffIdentity() && generation === staffIdentityGeneration()
    && sessionGeneration === sessionVersion() && session === readPermissionSessionSnapshot() && canWriteScenarioNow(operation)
}

const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}

/** 読み込みを増やさず、本人と代理モードの実際の切替を表示にも反映する。 */
export function useScenarioWriteAccess(operation: ScenarioWriteOperation = 'edit') {
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, () => null)
  useSyncExternalStore(subscribeSession, readPermissionSessionSnapshot, () => null)
  const allowed = canWriteScenarioNow(operation)
  return { allowed, known: identity !== null,
    reason: identity ? lockReason(allowed, operation === 'edit' ? 'feature' : 'manager') : undefined }
}
