'use client'

/*
 * ★V8 マイルの入口（/mileage）。?tab= で5つのタブを切り替える。
 * 受け付ける指定は今の画面と同じ（BEHAVIOR.md「受け付ける URL と指定」）。
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatMileageNumber, isMileageFriendsV6Overview } from './display'
import { MILEAGE_TABS, MileageShell, type MileageTabCounts, type MileageTabKey } from './frame'
import EarningRulesTab from './earning-rules'
import RewardsTab from './rewards'
import BalancesTab from './balances'
import HistoryTab from './history'
import ScoreTab from './score'

function MileageInner() {
  usePageTitle('マイル')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: MileageTabKey = MILEAGE_TABS.some((item) => item.key === rawTab)
    ? (rawTab as MileageTabKey)
    : 'earning-rules'
  const role = useStaffRole()
  /* E2Any：変える操作は押せない形。CSV・検索・絞り込みは使える。 */
  const readonly = !canManageRole(role)
  const narrow = useNarrowViewport()
  const { selectedAccountId, loading: accountLoading } = useAccount()

  /*
   * タブの名の横の件数。開いていないタブの数も出す（絵 OC0gy）。
   * 開いているタブが読み直したら、そのタブの数で上書きする。
   */
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
      }
    })
    return () => {
      cancelled = true
    }
  }, [accountLoading, selectedAccountId, setCount])

  const shell = useMemo(() => ({ tab, readonly, narrow, counts, setCount }), [tab, readonly, narrow, counts, setCount])

  return (
    <MileageShell.Provider value={shell}>
      {tab === 'earning-rules' ? <EarningRulesTab key={tab} /> : null}
      {tab === 'rewards' ? <RewardsTab key={tab} /> : null}
      {tab === 'balances' ? <BalancesTab key={tab} /> : null}
      {tab === 'history' ? <HistoryTab key={tab} /> : null}
      {tab === 'score' ? <ScoreTab key={tab} /> : null}
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
