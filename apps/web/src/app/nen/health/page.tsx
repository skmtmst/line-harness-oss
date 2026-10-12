'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import HealthPageV8 from '@/v8/nen-health/health'

export type HealthTabKey = 'logs' | 'concern' | 'items'
export type SummaryStatus = 'loading' | 'ready' | 'error'

export default function NenHealthPage() {
  return <Suspense fallback={null}><HealthInner /></Suspense>
}

function HealthInner() {
  usePageTitle('健康日記')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const tabParam = params.get('tab')
  const tab: HealthTabKey = tabParam === 'concern' ? 'concern' : tabParam === 'items' ? 'items' : 'logs'
  const changeTab = (next: HealthTabKey) => router.replace(next === 'logs' ? '/nen/health' : `/nen/health?tab=${next}`)
  return <HealthPageV8 accountId={selectedAccountId} tab={tab} onChangeTab={changeTab} />
}
