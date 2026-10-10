'use client'

import { Suspense } from 'react'
import TagsListV8 from '@/v8/tags/list'
import { useAccount } from '@/contexts/account-context'

export default function TagsPage() {
  const { selectedAccountId } = useAccount()
  return <Suspense fallback={null}><TagsListV8 accountId={selectedAccountId} /></Suspense>
}
