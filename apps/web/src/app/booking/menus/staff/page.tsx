'use client'
import { Suspense } from 'react'
import AssignMatrixV8 from '@/v8/booking-menus/assign'
export default function MenuStaffMatrix() {
  return <Suspense fallback={null}><AssignMatrixV8 /></Suspense>
}
