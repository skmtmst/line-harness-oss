'use client'

import { Suspense } from 'react'
import AccountDetailV8 from '@/v8/accounts-detail/detail'
import { DetailLoading } from '@/components/templates/detail-page'

export default function AccountDetailPage() {
  return <Suspense fallback={<DetailLoading />}><AccountDetailV8 /></Suspense>
}
