'use client'

/*
 * ★V8 マイルの入口（/mileage）。?tab= で5つのタブを切り替える。
 * 受け付ける指定は今の画面と同じ（BEHAVIOR.md「受け付ける URL と指定」）。
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import Button from '@/components/shared/button'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatMileageNumber, isMileageFriendsV6Overview } from './display'
import { MILEAGE_TABS, MileageFrame, MileageShell, type MileageTabCounts, type MileageTabKey } from './frame'
import EarningRulesTab from './earning-rules'
import RewardsTab from './rewards'
import BalancesTab from './balances'
import HistoryTab from './history'
import ScoreTab from './score'
import RanksTab from './ranks'

function MileageInner() {
  usePageTitle('マイル')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: MileageTabKey = MILEAGE_TABS.some((item) => item.key === rawTab)
    ? (rawTab as MileageTabKey)
    : 'earning-rules'
  const role = useStaffRole()
  /* ：変える操作は押せない形。CSV・検索・絞り込みは使える。 */
  const readonly = !canManageRole(role)
  const narrow = useNarrowViewport()
  const { selectedAccountId, loading: accountLoading } = useAccount()

  /*
   * タブの名の横の件数。開いていないタブの数も出す。
   * 開いているタブが読み直したら、そのタブの数で上書きする。
   */
  const [source, setSource] = useState<{ account: string; value: 'ec' | 'musubo' | 'error' } | null>(null)
  const [sourceRetry, setSourceRetry] = useState(0)
  const [counts, setCounts] = useState<MileageTabCounts>({})
  const setCount = useCallback((key: MileageTabKey, text: string | null) => {
    setCounts((current) => {
      const next = text ?? undefined
      if (current[key] === next) return current
      return { ...current, [key]: next }
    })
  }, [])

  useEffect(() => {
    if (accountLoading || !selectedAccountId) return
    let cancelled = false
    const accountId = selectedAccountId
    void Promise.allSettled([
      api.mileage.earningRulesV6({ accountId, limit: 1, offset: 0 }),
      api.mileage.rewards(accountId),
      api.mileage.friendsV6({ accountId, limit: 1, offset: 0 }),
    ]).then(([rules, rewards, friends]) => {
      if (cancelled) return
      if (rules.status === 'fulfilled' && rules.value.success && typeof rules.value.data?.pagination?.total === 'number') {
        setCount('earning-rules', formatMileageNumber(rules.value.data.pagination.total))
      }
      if (rewards.status === 'fulfilled' && rewards.value.success && Array.isArray(rewards.value.data?.rewards)) {
        setCount('rewards', formatMileageNumber(rewards.value.data.rewards.length))
      }
      if (friends.status === 'fulfilled' && friends.value.success && isMileageFriendsV6Overview(friends.value.data)) {
        setCount('balances', formatMileageNumber(friends.value.data.summary.totalMembers))
        setSource({ account: accountId, value: friends.value.data.balanceSource })
      } else {
        setSource({ account: accountId, value: 'error' })
      }
    })
    return () => {
      cancelled = true
    }
  }, [accountLoading, selectedAccountId, setCount, sourceRetry])

  const currentSource = source?.account === selectedAccountId ? source.value : null
  const shell = useMemo(() => ({ tab, readonly, narrow, counts, setCount, balanceSource: currentSource === 'ec' || currentSource === 'musubo' ? currentSource : null }), [tab, readonly, narrow, counts, setCount, currentSource])

  return (
    <MileageShell.Provider value={shell}>
      {tab === 'earning-rules' || tab === 'rewards' ? !accountLoading && !selectedAccountId ? <MileageFrame><ListState kind="empty" title="LINEアカウントを選択してください" /></MileageFrame>
        : currentSource === 'error' ? <MileageFrame><ListState kind="error" title="残高の設定元を読み込めませんでした" onRetry={() => setSourceRetry((value) => value + 1)} /></MileageFrame>
        : currentSource === null ? <MileageFrame><ListState kind="loading" title="残高の設定元を確認しています" /></MileageFrame>
        : tab === 'earning-rules' ? <EarningRulesTab key={tab} /> : <RewardsTab key={tab} /> : null}
      {tab === 'balances' ? <BalancesTab key={tab} /> : null}
      {tab === 'history' ? !accountLoading && !selectedAccountId ? <MileageFrame><ListState kind="empty" title="LINEアカウントを選択してください" /></MileageFrame> : currentSource === 'ec' || currentSource === 'musubo' ? <HistoryTab key={tab} />
        : currentSource === 'error' ? <MileageFrame><ListState kind="error" title="残高の設定元を読み込めませんでした" onRetry={() => setSourceRetry((value) => value + 1)} /></MileageFrame>
        : <MileageFrame><ListState kind="loading" title="残高の設定元を確認しています" /></MileageFrame> : null}
      {tab === 'score' ? <ScoreTab key={tab} /> : null}
      {tab === 'ranks' ? !accountLoading && !selectedAccountId ? <MileageFrame><ListState kind="empty" title="LINEアカウントを選択してください" /></MileageFrame> : source?.account !== selectedAccountId ? <MileageFrame><ListState kind="loading" title="会員ランクを確認しています" /></MileageFrame>
        : source.value === 'ec' ? <MileageFrame><ListState kind="empty" title="会員ランクはECと同期" description="会員ランクの設定はECと同期しています。" action={<Button href="/nen/members?tab=ranks">ランク設定を見る</Button>} /></MileageFrame>
        : source.value === 'error' ? <MileageFrame><ListState kind="error" title="会員ランクの設定元を読み込めませんでした" onRetry={() => setSourceRetry((value) => value + 1)} /></MileageFrame>
        : <RanksTab key={tab} /> : null}
    </MileageShell.Provider>
  )
}

export default function MileageV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="マイルを読み込んでいます" />}>
      <MileageInner />
    </Suspense>
  )
}
