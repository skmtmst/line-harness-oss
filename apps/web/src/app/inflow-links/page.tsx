'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import type { FeatureKey } from '../../lib/feature-key'
import AdConnectionsV8 from '@/v8/inflow-links/ad-connections'
import AdHistoryV8 from '@/v8/inflow-links/ad-history'
import SiteScriptV8 from '@/v8/inflow-links/site-script'
import AdsV8 from '@/v8/inflow-links/ads'
import InflowListV8 from '@/v8/inflow-links/list'

/*
  **タブの件数は直書きしない（#980）。**
  設計が描いた「24」「3」「5」は作り物の数で、一覧が0件のアカウントでも
  そのまま出ていた。件数は各タブの一覧と同じ集計から InflowLinksPageHost
  が付ける：「流入経路」は一覧が数える accountFilteredRows、「広告連携」
  「広告とのつなぎ」は広告タブが取得する ad-platforms の件数。
  取得前・失敗時は数字を出さない。
*/
const MERGED_TABS = [
  { key: 'links', label: '流入経路' },
  { key: 'script', label: 'サイトスクリプト' },
  { key: 'ads', label: '広告連携' },
  { key: 'connections', label: '広告とのつなぎ' },
]

/**
 * タブと機能キーの対応。サイトスクリプトは site_tracking(#859)で止める。
 * 流入経路・広告連携は inflow_tracking のまま（ページ自体のキー）。
 */
const TAB_FEATURE: Partial<Record<string, FeatureKey>> = {
  script: 'site_tracking',
}

function InflowLinksPageHost() {
  const { selectedAccountId } = useAccount()
  const visibility = useFeatureVisibility(selectedAccountId)
  const tab = useMergedTab(MERGED_TABS)
  const params = useSearchParams()

  const adView = params.get('view') === 'history' ? 'history' : 'connections'
  /*
    #980: タブの件数。各タブの一覧が実際に取得・表示している集計から
    報告された値だけを出す。報告が無い（未取得・失敗・そのタブをまだ
    開いていない）間は数字を付けない。
  */
  const [linksCount, setLinksCount] = useState<number | null>(null)
  const [adCounts, setAdCounts] = useState<{ total: number; connected: number } | null>(null)
  useEffect(() => {
    // アカウントを切り替えたら前の件数を捨てる。次の報告が来るまで数字は出ない。
    setLinksCount(null)
    setAdCounts(null)
  }, [selectedAccountId])
  // 同じ値の再報告で描画を回さないよう、中身が変わったときだけ入れ替える。
  const handleAdCounts = useCallback((counts: { total: number; connected: number } | null) => {
    setAdCounts((current) => {
      if (counts === null) return current === null ? current : null
      if (current && current.total === counts.total && current.connected === counts.connected) {
        return current
      }
      return counts
    })
  }, [])
  const countedTabs = MERGED_TABS.map((item) => {
    if (item.key === 'links' && linksCount !== null) {
      return { ...item, label: `${item.label} ${linksCount}` }
    }
    if (item.key === 'ads' && adCounts !== null) {
      return { ...item, label: `${item.label} ${adCounts.total}` }
    }
    if (item.key === 'connections' && adCounts !== null) {
      return { ...item, label: `${item.label} ${adCounts.connected}` }
    }
    return item
  })
  const visibleTabs = countedTabs.filter(
    (item) => !TAB_FEATURE[item.key] || visibility.enabled(TAB_FEATURE[item.key]!),
  )
  const tabFeature = TAB_FEATURE[tab]
  // 直URL（?tab=script）でも本文へ進ませず、機能設定への導線を出す。
  const tabBlocked =
    !!tabFeature && visibility.status === 'ready' && !visibility.enabled(tabFeature)
  /*
    ★V8 の一覧（src/v8/inflow-links）は絵どおりタブを出さない。
    ほかのページへは見出しの「広告とのつなぎ」「サイトスクリプト」と、
    数の帯の「広告連携」から行く。
  */
  const v8List = tab === 'links' && !tabBlocked
  if (v8List) return <InflowListV8 onRouteCountChange={setLinksCount} />
  /*
    ★V8 のサイトスクリプト・広告連携の絵にもタブは無い。見出しの「流入と計測へ」で戻る。
  */
  const v8NoTabs = !tabBlocked
  return (
    <div>
      {v8NoTabs ? null : <MergedTabs basePath="/inflow-links" tabs={visibleTabs} active={tab} />}
      {tabBlocked ? (
        <FeatureDisabledScreen featureId={tabFeature} />
      ) : (
        <>

          {/* 機能状態が確定するまで SiteScript を載せない。読み込み中の
              一瞬に計測APIを呼ぶと、offのaccountで403が画面全体のゲートを
              起こしてしまう。 */}
          {tab === 'script' && visibility.status === 'ready' && (<SiteScriptV8 />)}
          {tab === 'ads' && (<AdsV8 />)}
          {tab === 'connections' && (adView === 'history' ? <AdHistoryV8 /> : <AdConnectionsV8 />)}
        </>
      )}
    </div>
  )
}

export default function InflowLinksPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <InflowLinksPageHost />
    </Suspense>
  )
}
