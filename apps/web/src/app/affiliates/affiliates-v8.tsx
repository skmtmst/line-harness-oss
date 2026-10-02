'use client'

/*
 * ★V8-B 成果とアフィリエイト（板 `nJlxX` アフィリエイター・`h7dmB` 案件・
 * `OylSV` 成果承認・`aINnz` 支払い・`Eo56k` レポート。1152 は `KdFRI`、
 * 状態別は `rRk0C`、閲覧のみは `v9JWQ`）。
 *
 * オーナー決定（specs/pages-b/15 §案A）：コンバージョン（成果地点）と
 * 成果とアフィリエイトは別画面。左メニューの入口と中身を1対1にする。
 * 旧 `/conversions?tab=affiliates|offers|approvals|payment|report` は
 * ここへ送る（古い URL を壊さない）。`tab=points` はコンバージョン側へ返す。
 *
 * 板の頭の右上の操作はタブごとに違う（CSV・銀行用CSV・支払明細 など）ので、
 * 各タブが `registerHeaderActions` で登録し、タブを切り替えたら戻す。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { Tabs } from '@/components/shared/tabs'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { listAllConversionApprovals } from './tabs'
import AffiliatesTabV8 from './v8-affiliates-tab'
import OffersTabV8 from './v8-offers-tab'
import ApprovalsTabV8 from './v8-approvals-tab'
import PaymentTabV8 from './v8-payment-tab'
import ReportTabV8 from './v8-report-tab'
import { ReadOnlyBand } from './v8-shared'
import styles from './list-v8.module.css'

const TABS = [
  { key: 'affiliates', label: 'アフィリエイター', node: 'nJlxX' },
  { key: 'offers', label: '案件', node: 'h7dmB' },
  { key: 'approvals', label: '成果承認', node: 'OylSV' },
  { key: 'payment', label: '支払い', node: 'aINnz' },
  { key: 'report', label: 'レポート', node: 'Eo56k' },
] as const
type TabKey = (typeof TABS)[number]['key']

const TITLE_BY_TAB: Record<TabKey, string> = {
  affiliates: '成果とアフィリエイト',
  offers: '成果とアフィリエイト（案件）',
  approvals: '成果とアフィリエイト（成果承認）',
  payment: '成果とアフィリエイト（支払い）',
  report: '成果とアフィリエイト（レポート）',
}

export default function AffiliatesV8() {
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()

  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)

  // 成果地点はコンバージョンの画面へ返す（分かれたあとも古いURLを壊さない）。
  const rawTab = params.get('tab')
  useEffect(() => {
    if (rawTab === 'points') router.replace('/conversions?tab=points')
  }, [rawTab, router])
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'affiliates'

  // R291: 停止前の確認などから来る `?affiliate=` の絞り込み。
  const affiliateFocus = params.get('affiliate')

  usePageTitle(TITLE_BY_TAB[tab])
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  // ── タブの件数（板では アフィリエイター・案件・成果承認 に数を出す） ──
  const [counts, setCounts] = useState<{ affiliates: number | null; offers: number | null; approvals: number | null }>({
    affiliates: null,
    offers: null,
    approvals: null,
  })
  const countSeq = useRef(0)
  const loadCounts = useCallback(async () => {
    const seq = ++countSeq.current
    const [affiliatesRes, offersRes, pending] = await Promise.all([
      api.affiliates.list().catch(() => null),
      api.affiliateOffers.list().catch(() => null),
      listAllConversionApprovals('pending').catch(() => null),
    ])
    if (seq !== countSeq.current) return
    setCounts({
      affiliates: affiliatesRes?.success ? (affiliatesRes.data as unknown as unknown[]).length : null,
      offers: offersRes?.success ? (offersRes.data as unknown as unknown[]).length : null,
      approvals: pending ? pending.items.length : null,
    })
  }, [])
  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

  // ── 板の頭の右上の操作（今のタブが登録する） ──────────────────────────
  const [headerActions, setHeaderActions] = useState<ReactNode>(null)
  const registerHeaderActions = useCallback((node: ReactNode) => {
    setHeaderActions(node)
  }, [])

  const items = useMemo(
    () =>
      TABS.map((t) => ({
        label: t.label,
        count:
          t.key === 'affiliates'
            ? counts.affiliates ?? undefined
            : t.key === 'offers'
              ? counts.offers ?? undefined
              : t.key === 'approvals'
                ? counts.approvals ?? undefined
                : undefined,
        current: tab === t.key,
        onClick: () =>
          router.replace(t.key === 'affiliates' ? '/affiliates' : `/affiliates?tab=${t.key}`),
      })),
    [counts, router, tab],
  )

  return (
    <div className={styles.board} data-design-node={TABS.find((t) => t.key === tab)?.node}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.headTitle}>成果とアフィリエイト</h2>
          <p className={styles.headDesc}>
            紹介してくれる人（アフィリエイター）と案件を登録し、成果を認めて報酬を払います。成果の数え方はコンバージョンで決めます。
          </p>
        </div>
        <div className={styles.headActions}>{headerActions}</div>
      </div>

      <div className={styles.tabsRow}>
        <Tabs items={items} label="成果とアフィリエイトの画面" />
      </div>

      {!canEdit ? <ReadOnlyBand /> : null}

      {tab === 'affiliates' ? (
        <AffiliatesTabV8
          accountId={selectedAccountId}
          canEdit={canEdit}
          registerHeaderActions={registerHeaderActions}
          focusAffiliateId={affiliateFocus}
        />
      ) : tab === 'offers' ? (
        <OffersTabV8 canEdit={canEdit} registerHeaderActions={registerHeaderActions} />
      ) : tab === 'approvals' ? (
        <ApprovalsTabV8
          canEdit={canEdit}
          registerHeaderActions={registerHeaderActions}
          focusAffiliateId={affiliateFocus}
        />
      ) : tab === 'payment' ? (
        selectedAccountId ? (
          <PaymentTabV8
            accountId={selectedAccountId}
            canEdit={canEdit}
            registerHeaderActions={registerHeaderActions}
          />
        ) : (
          <p className={styles.footNote}>上のバーからLINEアカウントを選んでください。</p>
        )
      ) : (
        <ReportTabV8
          canEdit={canEdit}
          accountId={selectedAccountId}
          registerHeaderActions={registerHeaderActions}
        />
      )}
    </div>
  )
}
