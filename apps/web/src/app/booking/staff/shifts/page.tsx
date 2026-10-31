'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import StaffShiftsV8 from '@/v8/booking-staff/shifts'

function StaffShiftsEntry() {
  const staffId = useSearchParams().get('staff_id') ?? ''
  return <StaffShiftsV8 staffId={staffId} />
}

export default function StaffShiftsPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/booking/staff/shifts")} />}><StaffShiftsEntry /></Suspense>
}
