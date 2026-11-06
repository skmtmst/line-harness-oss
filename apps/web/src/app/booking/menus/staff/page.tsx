'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import AssignMatrixV8 from '@/v8/booking-menus/assign'
export default function MenuStaffMatrix() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/booking/menus/staff")} />}><AssignMatrixV8 /></Suspense>
}
