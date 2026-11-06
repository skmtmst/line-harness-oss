'use client'

import { Suspense } from 'react'
import { useMergedTab } from '@/components/layout/merged-tabs'
import { DetailLoading } from '@/components/templates/detail-page'
import EcCommerceScreen from '@/v8/settings/ec-commerce/screen'
import { EC_TABS } from './ec-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'

function EcCommercePageV8() {
  usePageTitle('EC連携')
  const tab = useMergedTab(EC_TABS, 'tab', 'events') as typeof EC_TABS[number]['key']
  return <EcCommerceScreen tab={tab} />
}

export default function EcCommercePage() {
  return <Suspense fallback={<DetailLoading />}><EcCommercePageV8 /></Suspense>
}
