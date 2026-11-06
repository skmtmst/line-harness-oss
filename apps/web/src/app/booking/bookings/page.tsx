'use client'
import type { BookingLedgerModel } from './use-booking-ledger'
import { useBookingLedger } from './use-booking-ledger'
export type { BookingLedgerModel } from './use-booking-ledger'

import BookingLedgerScreen from './ledger-screen'

export default function BookingsPage() {
  const model = useBookingLedger()
  return <BookingLedgerScreen model={model} />
}
