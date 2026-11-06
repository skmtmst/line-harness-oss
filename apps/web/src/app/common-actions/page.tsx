'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import CommonActionsV8 from '@/v8/automations/common-actions'

export default function CommonActionsPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/common-actions")} />}><CommonActionsV8 /></Suspense>
}
