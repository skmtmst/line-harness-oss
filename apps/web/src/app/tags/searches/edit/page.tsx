'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import Screen from '@/v8/tag-edit/search-edit'
import FeatureGate from '@/components/feature-gate'

/** V8 の入口。URL・読み書き・権限は画面側で保つ。 */
export default function SavedSearchEditPage() {
  return <FeatureGate feature="saved_searches"><Suspense fallback={<PagePending stage="route" {...routePendingForPath("/tags/searches/edit")} />}><Screen /></Suspense></FeatureGate>
}
