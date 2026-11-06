'use client'

import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import TagsListV8 from '@/v8/tags/list'
import { useAccount } from '@/contexts/account-context'

export default function TagsPage() {
  const { selectedAccountId } = useAccount()
  return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/tags")} />}><TagsListV8 accountId={selectedAccountId} /></Suspense>
}
