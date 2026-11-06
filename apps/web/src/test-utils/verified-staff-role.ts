import { act } from 'react'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'

/** 役割hookを差し替えた試験で、本人APIの控えも同じ役割へ明示的にそろえる。 */
export function verifiedStaffRole<T extends string | null>(role: T): T {
  if (role !== null && role !== 'owner' && role !== 'admin' && role !== 'staff' && role !== 'viewer') {
    throw new Error(`Unknown staff fixture role: ${role}`)
  }
  act(() => {
    if (role === null) { forgetStaffIdentity(); return }
    const identity: StaffMember = {
      id: 'staff-fixture', name: '本人', email: null, role,
      lineLinked: false, twoFactorEnabled: false, isActive: true,
      permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active',
      createdAt: '', updatedAt: '', assignedLineAccountId: null, canAccessDescendantAccounts: false,
    }
    rememberStaffIdentity(identity)
  })
  return role
}
