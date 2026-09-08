'use client'

import { Suspense, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Breadcrumb from '@/components/shared/breadcrumb'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { useAccount } from '@/contexts/account-context'
import { TABS } from './tabs/analytics-shared'
import { CrossTab } from './tabs/cross-tab'
import { FunnelTab } from './tabs/funnel-tab'
import { FriendsOverviewTab } from './tabs/friends-tab'
import { ReactionsOverviewTab } from './tabs/reactions-tab'
import { RoutesOverviewTab } from './tabs/routes-tab'
import { UsageOverviewTab } from './tabs/usage-tab'
import { UrlClicksOverviewTab } from './tabs/url-clicks-tab'
import { SavedAnalyticsTab } from './tabs/saved-tab'

function AnalyticsInner() {
  const tab = useMergedTab(TABS)
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [canManage, setCanManage] = useState(false)
  const [savedCount, setSavedCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active || !response.success) return
      setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => {
      active = false
    }
  }, [])
  // 保存件数は保存タブの取得結果を使い回す(点検#508軽9)。開く前は件数を出さない。
  useEffect(() => {
    setSavedCount(null)
  }, [selectedAccountId])
  if (accountLoading) {
    return <div className="text-ink-faint p-8 text-center text-sm">分析を読み込んでいます</div>
  }
  if (!selectedAccountId) {
    return <div className="text-ink-faint p-8 text-center text-sm">LINE公式アカウントを選んでください</div>
  }
  const currentLabel = TABS.find((item) => item.key === tab)?.label ?? '分析'
  const displayTabs = TABS.map((item) => item.key === 'saved' && savedCount !== null
    ? { ...item, label: `${item.label} ${savedCount}` }
    : item)
  return (
    <div data-analytics-design="v6">
      <Breadcrumb
        items={tab === 'friends'
          ? [{ label: '成果と分析' }, { label: '分析' }]
          : [{ label: '分析', href: '/analytics?tab=friends' }, { label: currentLabel }]}
        className="mb-3"
      />
      <MergedTabs basePath="/analytics" tabs={displayTabs} active={tab} />
      {tab === 'friends' && <FriendsOverviewTab accountId={selectedAccountId} />}
      {tab === 'reactions' && <ReactionsOverviewTab accountId={selectedAccountId} />}
      {tab === 'routes' && <RoutesOverviewTab accountId={selectedAccountId} />}
      {tab === 'usage' && <UsageOverviewTab accountId={selectedAccountId} />}
      {tab === 'cross' && <CrossTab accountId={selectedAccountId} canManage={canManage} />}
      {tab === 'funnel' && <FunnelTab accountId={selectedAccountId} canManage={canManage} />}
      {tab === 'url-clicks' && <UrlClicksOverviewTab accountId={selectedAccountId} />}
      {tab === 'saved' && <SavedAnalyticsTab accountId={selectedAccountId} onCountChange={setSavedCount} />}
    </div>
  )
}

export default function AnalyticsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AnalyticsInner />
    </Suspense>
  )
}
