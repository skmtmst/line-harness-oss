'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import CampaignEdit from '@/v8/nen-campaigns/edit'
import ColumnIntros from '@/v8/nen-campaigns/column-intros'
import ListState from '@/components/shared/list-state'

function NenEditRoute() {
  const campaignKey = useSearchParams().get('key') ?? ''
  const { selectedAccountId } = useAccount()
  return campaignKey ? <CampaignEdit campaignKey={campaignKey} /> : <ColumnIntros key={selectedAccountId} />
}

export default function NenColumnEditPage() {
  return <Suspense fallback={<ListState kind="loading" />}><NenEditRoute /></Suspense>
}
