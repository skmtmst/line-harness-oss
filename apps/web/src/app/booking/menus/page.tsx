'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import { useAccount } from '@/contexts/account-context'
import BookingSettingsV8 from '@/v8/booking-menus/settings'

function MenusPageEntry() {
  const { selectedAccountId } = useAccount()
  return <BookingSettingsV8 accountId={selectedAccountId} />
}
export default function MenusPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/booking/menus")} />}><MenusPageEntry /></Suspense>
}
