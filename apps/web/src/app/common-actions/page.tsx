'use client'

import { Suspense } from 'react'
import CommonActionsV8 from '@/v8/automations/common-actions'

export default function CommonActionsPage() {
  return <Suspense fallback={null}><CommonActionsV8 /></Suspense>
}
