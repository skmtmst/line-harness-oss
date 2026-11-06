'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import StoreComparisonList from '@/v8/hq-store-compare/list'

/* ★V8 統括「店の比較」。?diffOnly=1（違いだけ表示）を読むので Suspense で包む。 */
export default function Page() {
  return (
    <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/hq/store-comparison")} />}>
      <StoreComparisonList />
    </Suspense>
  )
}
