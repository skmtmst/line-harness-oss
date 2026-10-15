'use client'
import { Suspense } from 'react'
import MenuFormV8 from '@/v8/booking-menus/menu-form'
export default function NewBookingMenuPage() {
  return <Suspense fallback={null}><MenuFormV8 /></Suspense>
}
