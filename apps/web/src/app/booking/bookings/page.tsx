'use client'
import type { BookingLedgerModel } from '../../../v8/booking/bookings/use-booking-ledger'
import { useBookingLedger } from '../../../v8/booking/bookings/use-booking-ledger'
export type { BookingLedgerModel } from '../../../v8/booking/bookings/use-booking-ledger'

import BookingLedgerScreen from '../../../v8/booking/bookings/ledger-screen'

export default function BookingsPage() {
  const model = useBookingLedger()
  return <BookingLedgerScreen model={model} />
}
