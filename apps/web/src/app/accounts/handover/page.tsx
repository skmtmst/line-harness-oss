'use client'

import { Suspense } from 'react'
import HandoverV8 from '@/v8/accounts-detail/handover'
import { DetailLoading } from '@/components/templates/detail-page'

export default function HandoverPage() {
  return <Suspense fallback={<DetailLoading />}><HandoverV8 /></Suspense>
}
