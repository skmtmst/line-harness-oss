'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import Screen from '@/v8/friends/migrations/page'

/** V8 の入口。URL・読み書き・権限は画面側で保つ。 */
export default function FriendMigrationsPage() {
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/friends/migrations")} />}><Screen /></Suspense>
}
