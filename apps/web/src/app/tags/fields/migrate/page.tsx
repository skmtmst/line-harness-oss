'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import Screen from '@/v8/tags/field-migrate'
import FeatureGate from '@/components/feature-gate'

/** V8 の入口。URL・読み書き・権限は画面側で保つ。 */
export default function MigrateFriendFieldPage() {
  return <FeatureGate feature="friend_fields"><Suspense fallback={<PagePending stage="route" {...routePendingForPath("/tags/fields/migrate")} />}><Screen /></Suspense></FeatureGate>
}
