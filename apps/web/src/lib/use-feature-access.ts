import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey, type DeliveryFeature, type StaffFeatureOperation } from '@line-crm/shared'
import { useStaffRole } from './staff-role'
import { canEditFeature, canViewFeature } from './staff-capability'

export function useFeatureAccess(feature: DeliveryFeature, operation: StaffFeatureOperation = 'edit'): boolean {
  const role = useStaffRole()
  if (operation === 'export' && role === 'viewer') return false
  const key = deliveryPermissionKey(feature, operation)
  const read = operation === 'view' || operation === 'export'
  return (read ? canViewFeature(DELIVERY_FEATURE_POLICIES[feature].key, role) : canEditFeature(DELIVERY_FEATURE_POLICIES[feature].key, role))
    && (read ? canViewFeature(key, role) : canEditFeature(key, role))
}

export function usePermissionAccess(key: string, read = false): boolean {
  const role = useStaffRole()
  return read ? canViewFeature(key, role) : canEditFeature(key, role)
}
