import { Suspense, type ReactNode } from 'react'
import BookingLedgerFrame from '@/v8/booking-bookings/ledger-frame'

export default function BookingLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}><BookingLedgerFrame>{children}</BookingLedgerFrame></Suspense>
}
