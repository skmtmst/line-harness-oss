'use client'

import { useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { effectiveStaffRole, useStaffIdentity } from '@/lib/staff-role'
import { readStaffIdentity } from '@/lib/staff-identity-state'
import type { LineAccount, StaffMember } from '@line-crm/shared'

/** 管理者の最初の読取を、許可一覧にある単一アカウントへ向ける。 */
export function initialEmergencyTarget(role: StaffMember['role'] | null, selectedId: string | null, accounts: Pick<LineAccount, 'id'>[]): string {
  if (role === null) return ''
  if (role === 'owner') return 'all'
  return accounts.find(account => account.id === selectedId)?.id ?? accounts[0]?.id ?? ''
}

export function useEmergencyTarget(accounts: LineAccount[]) {
  const identity = useStaffIdentity()
  const role = effectiveStaffRole(identity)
  const { selectedAccountId, loading } = useAccount()
  const defaultTargetAccountId = initialEmergencyTarget(role, selectedAccountId, accounts)
  const [requested, setRequested] = useState<string | null>(null)
  const targetAccountId = requested && (requested === 'all' ? role === 'owner' : accounts.some(account => account.id === requested)) ? requested : defaultTargetAccountId
  const canReadTarget = identity !== null && !loading && Boolean(targetAccountId)
  const selectTarget = (value: string) => {
    if (!readStaffIdentity() || loading || (value === 'all' ? effectiveStaffRole(readStaffIdentity()) !== 'owner' : !accounts.some(account => account.id === value))) return false
    setRequested(value)
    return true
  }
  return { defaultTargetAccountId, targetAccountId, canReadTarget, selectTarget, role }
}
