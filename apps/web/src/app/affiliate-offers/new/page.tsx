'use client'

import { Suspense } from 'react'
import { NewOfferV8 } from '../new-offer-v8'

export default function NewAffiliateOfferPage() {
  return <Suspense fallback={null}><NewOfferV8 /></Suspense>
}
