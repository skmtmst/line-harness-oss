'use client'

import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import { lockReason } from '@/components/shared/permission-lock'
import { canEditFeature } from '@/lib/staff-capability'
import { effectiveStaffRole, readStaffIdentity } from '@/lib/staff-identity-state'

/** 保持された操作も、実行時の本人・編集鍵・代理モードで判定する。 */
export function canEditAutoReplyNow(): boolean {
  const role = effectiveStaffRole(readStaffIdentity())
  return canEditFeature(DELIVERY_FEATURE_POLICIES.autoReplies.key, role)
    && canEditFeature(deliveryPermissionKey('autoReplies', 'edit'), role)
    && !lockReason(true)
}
