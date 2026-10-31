'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import { NewAutomationV8 } from '@/v8/automations/create/create'

export default function NewAutomationPage() {
  return (
    <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/automations/new")} />}>
      <NewAutomationV8 chrome="create" />
    </Suspense>
  )
}
