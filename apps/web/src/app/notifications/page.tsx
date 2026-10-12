'use client'

import { Suspense } from 'react'
import NotificationsV8 from '@/v8/notifications/list'

export default function NotificationsPage() {
  return <Suspense fallback={null}><NotificationsV8 /></Suspense>
}
