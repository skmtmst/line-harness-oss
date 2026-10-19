'use client'
import type { BookingDetailModel } from './use-booking-detail'
import { useBookingDetail } from './use-booking-detail'
export type { BookingDetailModel } from './use-booking-detail'

import BookingDetailScreen from './detail-screen'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'

import { Suspense } from 'react'

function BookingDetailController() {
  const model = useBookingDetail()
  return <>
    <BookingDetailScreen model={model} />
    <UnsavedLeaveDialog open={model.leaveTarget !== null} subject="予約の変更" onConfirm={model.confirmLeave} onCancel={model.cancelLeave} />
  </>
}

export default function BookingDetailPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><BookingDetailController /></Suspense>
}
