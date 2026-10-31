'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useStaffIdentityLoad } from '@/lib/staff-role'
import { isHqShellPath } from '@/lib/menu'
import PagePending from '@/components/templates/page-pending'

/** Keep account-only members out of the tenant console before its pages mount. */
export default function HqAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { identity, failed, retry } = useStaffIdentityLoad()
  const hq = isHqShellPath(pathname)
  const allowed = identity?.accountScope === 'all'

  useEffect(() => {
    if (hq && identity && !allowed) router.replace('/')
  }, [hq, identity, allowed, router])

  if (hq && !allowed) return <PagePending failed={failed} onRetry={retry} />
  return <>{children}</>
}
