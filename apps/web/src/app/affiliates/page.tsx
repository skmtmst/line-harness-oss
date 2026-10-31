'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import AffiliatesV8 from '@/v8/affiliates/affiliates'

export default function AffiliatesPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/affiliates")} />}><AffiliatesV8 /></Suspense>
}
