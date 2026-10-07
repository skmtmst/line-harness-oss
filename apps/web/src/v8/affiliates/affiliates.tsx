'use client'

/*
 * ★V8 成果とアフィリエイトの入口（/affiliates）。?tab= で5つのタブを切り替える。
 * 受け付ける指定は今の画面と同じ（BEHAVIOR.md「受け付ける URL と指定」）。
 *
 * オーナー決定：コンバージョン（成果地点）と成果とアフィリエイトは別画面。
 * `?tab=points` はコンバージョンの画面へ返す（古い URL を壊さない）。
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { listAllConversionApprovals } from './display'
import { AFFILIATE_TABS, AffiliateShell, type AffiliateTabCounts, type AffiliateTabKey } from './frame'
import AffiliatorsTab from './affiliators'
import OffersTab from './offers'
import ApprovalsTab from './approvals'
import PaymentTab from './payment'
import ReportTab from './report'

const TITLE_BY_TAB: Record<AffiliateTabKey, string> = {
  affiliates: '成果とアフィリエイト',
  offers: '成果とアフィリエイト（案件）',
  approvals: '成果とアフィリエイト（成果承認）',
  payment: '成果とアフィリエイト（支払い）',
  report: '成果とアフィリエイト（レポート）',
}

function AffiliatesInner() {
  const router = useRouter()
  const params = useSearchParams()
  const rawTab = params.get('tab')
  useEffect(() => {
    if (rawTab === 'points') router.replace('/conversions?tab=points')
  }, [rawTab, router])
  const tab: AffiliateTabKey = AFFILIATE_TABS.some((item) => item.key === rawTab) ? (rawTab as AffiliateTabKey) : 'affiliates'
  const focusAffiliateId = params.get('affiliate')

  usePageTitle(TITLE_BY_TAB[tab])
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  const role = useStaffRole()
  /* v9JWQ：変える操作は出さない。CSV・検索・絞り込み・明細を見るは使える。 */
  const readonly = !canManageRole(role)
  const narrow = useNarrowViewport()
  const { selectedAccountId } = useAccount()

  /*
   * タブの名の横の件数（アフィリエイター・案件・成果承認）。開いていないタブの数も出す。
   * 開いているタブが読み直したら、その数で上書きする。
   */
  const [counts, setCounts] = useState<AffiliateTabCounts>({})
  const setCount = useCallback((key: AffiliateTabKey, text: string | null) => {
    setCounts((current) => {
      const next = text ?? undefined
      if (current[key] === next) return current
      return { ...current, [key]: next }
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      api.affiliates.list(),
      api.affiliateOffers.list(),
      listAllConversionApprovals('pending'),
    ]).then(([affiliates, offers, pending]) => {
      if (cancelled) return
      if (affiliates.status === 'fulfilled' && affiliates.value.success && Array.isArray(affiliates.value.data)) {
        setCount('affiliates', formatNumber(affiliates.value.data.length))
      }
      if (offers.status === 'fulfilled' && offers.value.success && Array.isArray(offers.value.data)) {
        setCount('offers', formatNumber(offers.value.data.length))
      }
      if (pending.status === 'fulfilled') setCount('approvals', formatNumber(pending.value.items.length))
    })
    return () => { cancelled = true }
  }, [selectedAccountId, setCount])

  const shell = useMemo(
    () => ({ tab, readonly, narrow, accountId: selectedAccountId, counts, setCount, focusAffiliateId }),
    [tab, readonly, narrow, selectedAccountId, counts, setCount, focusAffiliateId],
  )

  return (
    <AffiliateShell.Provider value={shell}>
      {tab === 'affiliates' ? <AffiliatorsTab key={tab} /> : null}
      {tab === 'offers' ? <OffersTab key={tab} /> : null}
      {tab === 'approvals' ? <ApprovalsTab key={tab} /> : null}
      {tab === 'payment' ? <PaymentTab key={tab} /> : null}
      {tab === 'report' ? <ReportTab key={tab} /> : null}
    </AffiliateShell.Provider>
  )
}

export default function AffiliatesV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="成果とアフィリエイトを読み込んでいます" />}>
      <AffiliatesInner />
    </Suspense>
  )
}
