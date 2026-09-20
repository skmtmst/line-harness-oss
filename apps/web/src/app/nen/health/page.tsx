'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import ScrollableTabs from '@/components/layout/scrollable-tabs'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { nenPetsApi, type NenHealthKpis, type NenHealthSummaryData } from '@/lib/nen-pets-api'
import HealthTab from './health-tab'
import ItemsTab from './items-tab'
import SummaryDrawer, { SummarySheet } from './summary-drawer'

export type HealthTabKey = 'logs' | 'concern' | 'items'
export type SummaryStatus = 'loading' | 'ready' | 'error'

/**
 * 然-NEN- 健康日記。★V6 37-4（`mtoCA`）。
 *
 * 記録はお客様がマイページ（★V6 37-2-B）で付ける。ここでは変化に気づくための一覧と、
 * 診察時に獣医師へ見せる「30日のまとめ」を出す。医療判断はしない。
 * タブ：記録のあるペット／気になる変化（同じ一覧を「変化：気になる」で絞る）／記録の項目（説明）。
 * 「獣医師向けPDFを書き出す」＝開いている「30日のまとめ」をブラウザの印刷（PDFに保存）で出す。
 */
export default function NenHealthPage() {
  return (
    <Suspense fallback={null}>
      <HealthInner />
    </Suspense>
  )
}

function HealthInner() {
  usePageTitle('健康日記')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const tabParam = params.get('tab')
  const tab: HealthTabKey = tabParam === 'concern' ? 'concern' : tabParam === 'items' ? 'items' : 'logs'
  const [kpis, setKpis] = useState<NenHealthKpis | null>(null)
  const [summaryPetId, setSummaryPetId] = useState<string | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>('loading')
  const [summary, setSummary] = useState<NenHealthSummaryData | null>(null)

  const changeTab = (next: HealthTabKey) => router.replace(next === 'logs' ? '/nen/health' : `/nen/health?tab=${next}`)

  const loadSummary = useCallback(async () => {
    if (!selectedAccountId || !summaryPetId) return
    setSummaryStatus('loading')
    try {
      const res = await nenPetsApi.healthSummary(selectedAccountId, summaryPetId)
      if (!res.success) throw new Error(res.error)
      setSummary(res.data)
      setSummaryStatus('ready')
    } catch {
      setSummaryStatus('error')
    }
  }, [selectedAccountId, summaryPetId])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const closeSummary = () => { setSummaryPetId(null); setSummary(null) }
  const canPrint = summaryPetId !== null && summaryStatus === 'ready' && summary !== null

  return (
    <div data-design-node="mtoCA" className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[{ label: '専用機能' }, { label: '健康日記' }]}
        title="健康日記"
        description=""
        actions={<Button type="button" onClick={() => window.print()} disabled={!canPrint} title={canPrint ? undefined : '一覧の「30日のまとめ」を開くと書き出せます'}>獣医師向けPDFを書き出す</Button>}
      />
      <div data-design="Tabs" data-design-node="health-tabs">
        {/* U091: 右にはみ出すタブへ届くよう、横スクロール＋端の送りボタン付き。 */}
        <ScrollableTabs
          items={[
            { label: '記録のあるペット', count: kpis?.petsWithRecords, current: tab === 'logs', onClick: () => changeTab('logs') },
            { label: '気になる変化', count: kpis?.concerning, current: tab === 'concern', onClick: () => changeTab('concern') },
            { label: '記録の項目', current: tab === 'items', onClick: () => changeTab('items') },
          ]}
        />
      </div>

      {!selectedAccountId ? null : tab === 'items' ? (
        <ItemsTab />
      ) : (
        <HealthTab key={tab} accountId={selectedAccountId} concernOnly={tab === 'concern'} onKpis={setKpis} onOpenSummary={setSummaryPetId} />
      )}

      <SummaryDrawer open={summaryPetId !== null} status={summaryStatus} summary={summary} onClose={closeSummary} onRetry={() => void loadSummary()} onPrint={() => window.print()} />
      {canPrint ? <SummarySheet summary={summary!} /> : null}
    </div>
  )
}
