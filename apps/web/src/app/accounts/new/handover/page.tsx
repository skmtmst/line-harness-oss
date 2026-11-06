'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import ResumeFollowerHandover from '@/v8/account-new/resume-handover'

export default function HandoverPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/accounts/new/handover")} />}><ResumeFollowerHandover /></Suspense>
}
