'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import MenuFormV8 from '@/v8/booking-menus/menu-form'
export default function NewBookingMenuPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/booking/menus/new")} />}><MenuFormV8 /></Suspense>
}
