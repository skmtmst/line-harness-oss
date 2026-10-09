'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import EventsCreateV8 from '@/v8/events/create'

export default function NewEventPage() {
  return <Suspense fallback={<ListState kind="loading" />}><EventsCreateV8 /></Suspense>
}
