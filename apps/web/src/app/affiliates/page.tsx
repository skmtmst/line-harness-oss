'use client'

import { Suspense } from 'react'
import AffiliatesV8 from '@/v8/affiliates/affiliates'

export default function AffiliatesPage() {
  return <Suspense><AffiliatesV8 /></Suspense>
}
