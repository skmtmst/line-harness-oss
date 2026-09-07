'use client'

import { useEffect, useState } from 'react'
import { Tabs } from '@/components/shared/tabs'
import { api } from '@/lib/api'
import { EC_TABS } from './ec-tabs'

type EcTabKey = typeof EC_TABS[number]['key']
type Counts = Partial<Record<Exclude<EcTabKey, 'connector'>, number>>

const HREFS: Record<EcTabKey, string> = {
  events: '/ec-commerce',
  identity: '/ec-commerce/identity-candidates',
  subscriptions: '/ec-commerce?tab=subscriptions',
  connector: '/ec-commerce?tab=connector',
}

/** 4つの入口に、各APIが数えた実件数を出す。取得不能な数は作らない。 */
export default function EcTabs({
  accountId,
  active,
}: {
  accountId: string | null
  active: EcTabKey
}) {
  const [counts, setCounts] = useState<Counts>({})

  useEffect(() => {
    let alive = true
    if (!accountId) {
      setCounts({})
      return () => { alive = false }
    }
    setCounts({})
    Promise.allSettled([
      api.ecCommerce.overview(accountId),
      api.ecCommerce.operationIdentityCandidates({ lineAccountId: accountId, limit: 1 }),
      api.ecCommerce.subscriptions({ lineAccountId: accountId, limit: 1 }),
    ]).then(([overview, identities, subscriptions]) => {
      if (!alive) return
      setCounts({
        events: overview.status === 'fulfilled' && overview.value.success
          ? overview.value.data.total
          : undefined,
        identity: identities.status === 'fulfilled' && identities.value.success
          ? identities.value.data.summary.unmatched
          : undefined,
        subscriptions: subscriptions.status === 'fulfilled' && subscriptions.value.success
          ? subscriptions.value.data.summary.total
          : undefined,
      })
    })
    return () => { alive = false }
  }, [accountId])

  return (
    <Tabs items={EC_TABS.map((tab) => ({
      label: tab.label,
      href: HREFS[tab.key],
      count: tab.key === 'connector' ? undefined : counts[tab.key],
      current: active === tab.key,
    }))} />
  )
}
