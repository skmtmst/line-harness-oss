'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useStaffIdentity } from '@/lib/staff-role'
import { isHqShellPath } from '@/lib/menu'

/** Keep account-only members out of the tenant console before its pages mount. */
export default function HqAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const identity = useStaffIdentity()
  const hq = isHqShellPath(pathname)
  const allowed = identity?.accountScope === 'all'

  useEffect(() => {
    if (hq && identity && !allowed) router.replace('/')
  }, [hq, identity, allowed, router])

  if (hq && !allowed) return <div role="status" aria-label="権限を確認中" />
  return <>{children}</>
}
