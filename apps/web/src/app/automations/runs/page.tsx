'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import AutomationRunsV8 from '@/v8/automations/runs'


export default function AutomationRunsPage() {
  return (
    <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/automations/runs")} />}>
      <AutomationRunsV8 />
    </Suspense>
  )
}
