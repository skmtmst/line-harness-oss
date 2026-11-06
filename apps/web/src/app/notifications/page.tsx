'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import NotificationsV8 from '@/v8/notifications/list'

export default function NotificationsPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/notifications")} />}><NotificationsV8 /></Suspense>
}
