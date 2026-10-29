'use client'

import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import { lockReason } from '@/components/shared/permission-lock'
import { canEditFeature } from '@/lib/staff-capability'
import { effectiveStaffRole, readStaffIdentity } from '@/lib/staff-identity-state'

/** 保存されたcallbackも、本人と既存の編集条件・代理モードを実行時に確かめる。 */
export function canEditWizardNow(): boolean {
  const role = effectiveStaffRole(readStaffIdentity())
  return canEditFeature(DELIVERY_FEATURE_POLICIES.autoReplies.key, role)
    && canEditFeature(deliveryPermissionKey('autoReplies', 'edit'), role)
    && !lockReason(true)
}
