'use client'
import { Suspense } from 'react'
import { useAccount } from '@/contexts/account-context'
import BookingSettingsV8 from '@/v8/booking-menus/settings'

function MenusPageEntry() {
  const { selectedAccountId } = useAccount()
  return <BookingSettingsV8 accountId={selectedAccountId} />
}
export default function MenusPage() {
  return <Suspense fallback={null}><MenusPageEntry /></Suspense>
}
