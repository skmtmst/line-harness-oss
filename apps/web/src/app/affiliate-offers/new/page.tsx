'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import AffiliateOfferCreateV8 from '@/v8/affiliate-offer-new/create'

/*
 * 板 （案件を作る）。2026-10-07 から画面は src/v8/affiliate-offer-new（保存の口・入力の断り方は
 * ../new-offer-v8.tsx から写した。写し元は切り替えの日まで残す）。
 */
export default function NewAffiliateOfferPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/affiliate-offers/new")} />}><AffiliateOfferCreateV8 /></Suspense>
}
