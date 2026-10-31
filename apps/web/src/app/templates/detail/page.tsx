'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import TemplateDetailV8 from '@/v8/template-detail/detail'

export default function TemplateDetailPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/templates/detail")} />}><TemplateDetailV8 /></Suspense>
}
