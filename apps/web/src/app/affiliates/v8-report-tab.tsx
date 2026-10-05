'use client'

/*
 * ★V8-B 成果とアフィリエイト「レポート」タブ（板 `Eo56k`）。
 * アフィリエイターごと／案件ごとの2見方。数は「認めた成果」だけで、
 * 期間は今月・先月・すべてから選ぶ。成果地点ごとの詳しいレポートは
 * 「分析›レポート」側に分かれた（案内で導線を残す）。
 *
 * 行を押すと、その人の成果の明細（引き出し）を開く。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BarChart3, Download, Medal, TrendingUp } from 'lucide-react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import { csvCell } from './offer-list-view'
import { jstMonthKey, type ConfirmedState } from './offer-kpi'
import { listAllConversionApprovals, type AffiliateItem, type AffiliateListRow } from './tabs'
import { KpiStrip, KpiCell, NoticeBar, EmptyState, ZeroResultState, LoadingRows, LoadError } from './v8-shared'
import AffiliateDrawerV8 from './v8-drawer'
import { reportMonthKey as monthKeyShifted, reportPeriodLabel as monthLabel, type ReportPeriod } from './report-period'
import Notice from '@/components/shared/notice'
import './list-v8.css'

function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

type ViewKey = 'affiliate' | 'offer'
type PeriodKey = ReportPeriod

interface AffiliateAgg {
  id: string
  name: string
  conversions: number
  revenue: number
  reward: number
  missingReward: boolean
  prevReward: number | null
  topOfferName: string | null
}

interface OfferAgg {
  id: string
  name: string
  conversions: number
  revenue: number
  reward: number
  missingReward: boolean
  prevReward: number | null
}

export default function ReportTabV8({
  canEdit,
  accountId,
  registerHeaderActions,
}: {
  canEdit: boolean
  accountId: string | null
  registerHeaderActions: (node: ReactNode) => void
}) {
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [state, setState] = useState<ConfirmedState>('loading')
  const [affiliates, setAffiliates] = useState<AffiliateItem[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewKey>('affiliate')
  const [period, setPeriod] = useState<PeriodKey>('this_month')
  const [drawerRow, setDrawerRow] = useState<AffiliateListRow | null>(null)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setState('loading')
    setItems([])
    setAffiliates([])
    setDrawerRow(null)
    setLoadError('')
    try {
      const [approved, affiliatesRes] = await Promise.all([
        listAllConversionApprovals('approved'),
        api.affiliates.list(),
      ])
      if (!affiliatesRes.success) throw new Error('紹介者を読み込めませんでした。集計は表示していません。')
      if (approved.truncated) throw new Error('成果が取得上限を超えています。全件を集計できないため、合計とCSVは表示していません。')
      if (seq === requestSeq.current) {
        setItems(approved.items)
        setAffiliates(affiliatesRes.data as unknown as AffiliateItem[])
        setState('ready')
      }
    } catch (caught) {
      if (seq === requestSeq.current) {
        setState('error')
        setLoadError(caught instanceof Error ? caught.message : 'レポートを読み込めませんでした。')
      }
    }
  }, [accountId])

  useEffect(() => {
    void load()
    return () => { ++requestSeq.current }
  }, [load])

  // 期間で絞った「認めた成果」
  const monthKey = period === 'this_month' ? monthKeyShifted(0) : period === 'last_month' ? monthKeyShifted(-1) : null
  const prevMonthKey = monthKey ? monthKeyShifted(period === 'this_month' ? -1 : -2) : null

  const inPeriod = useMemo(
    () => items.filter((item) => monthKey == null || jstMonthKey(item.createdAt) === monthKey),
    [items, monthKey],
  )
  const inPrevPeriod = useMemo(
    () => items.filter((item) => prevMonthKey != null && jstMonthKey(item.createdAt) === prevMonthKey),
    [items, prevMonthKey],
  )

  const rewardOf = (item: ConversionApprovalItem) => item.rewardAmount ?? 0

  const hasMissingReward = inPeriod.some((item) => item.rewardAmount == null)
  const hasMissingPreviousReward = inPrevPeriod.some((item) => item.rewardAmount == null)

  // KPI：成果・売上・報酬・1件あたりの報酬（板 Eo56k）
  const totalRevenue = inPeriod.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const totalReward = inPeriod.reduce((sum, item) => sum + rewardOf(item), 0)
  const prevConversions = inPrevPeriod.length
  const prevReward = inPrevPeriod.reduce((sum, item) => sum + rewardOf(item), 0)
  const perItem = inPeriod.length === 0 ? 0 : Math.round(totalReward / inPeriod.length)
  const prevPerItem = inPrevPeriod.length === 0 ? 0 : Math.round(prevReward / inPrevPeriod.length)

  // アフィリエイターごと
  const affiliateRows = useMemo<AffiliateAgg[]>(() => {
    const map = new Map<string, { conversions: number; revenue: number; reward: number; missingReward: boolean; offers: Map<string, number> }>()
    for (const item of inPeriod) {
      const current = map.get(item.affiliateId) ?? { conversions: 0, revenue: 0, reward: 0, missingReward: false, offers: new Map<string, number>() }
      current.conversions += 1
      current.revenue += item.value ?? 0
      current.reward += rewardOf(item)
      current.missingReward ||= item.rewardAmount == null
      if (item.offerName) current.offers.set(item.offerName, (current.offers.get(item.offerName) ?? 0) + 1)
      map.set(item.affiliateId, current)
    }
    const prevMap = new Map<string, number>()
    for (const item of inPrevPeriod) {
      prevMap.set(item.affiliateId, (prevMap.get(item.affiliateId) ?? 0) + rewardOf(item))
    }
    // 期間に成果が無い人も「0件」で並べる（見本の0件行）。
    for (const affiliate of affiliates) {
      if (!map.has(affiliate.id)) {
        map.set(affiliate.id, { conversions: 0, revenue: 0, reward: 0, missingReward: false, offers: new Map() })
      }
    }
    return [...map].map(([id, value]) => {
      const top = [...value.offers].sort((a, b) => b[1] - a[1])[0]
      const prev = prevMap.get(id)
      return {
        id,
        name: value.conversions > 0
          ? (inPeriod.find((i) => i.affiliateId === id)?.affiliateName ?? affiliates.find((a) => a.id === id)?.name ?? '名前を読み込めませんでした')
          : (affiliates.find((a) => a.id === id)?.name ?? '名前を読み込めませんでした'),
        conversions: value.conversions,
        revenue: value.revenue,
        reward: value.reward,
        missingReward: value.missingReward,
        prevReward: prevMonthKey == null || inPrevPeriod.some((item) => item.affiliateId === id && item.rewardAmount == null) ? null : (prev ?? 0),
        topOfferName: top?.[0] ?? null,
      }
    }).sort((a, b) => b.conversions - a.conversions || b.reward - a.reward)
  }, [inPeriod, inPrevPeriod, affiliates, prevMonthKey])

  // 案件ごと
  const offerRows = useMemo<OfferAgg[]>(() => {
    const map = new Map<string, { name: string; conversions: number; revenue: number; reward: number; missingReward: boolean }>()
    for (const item of inPeriod) {
      const id = item.offerId ?? 'none'
      const current = map.get(id) ?? { name: item.offerName ?? '案件未設定', conversions: 0, revenue: 0, reward: 0, missingReward: false }
      current.conversions += 1
      current.revenue += item.value ?? 0
      current.reward += rewardOf(item)
      current.missingReward ||= item.rewardAmount == null
      map.set(id, current)
    }
    const prevMap = new Map<string, number>()
    for (const item of inPrevPeriod) {
      const id = item.offerId ?? 'none'
      prevMap.set(id, (prevMap.get(id) ?? 0) + rewardOf(item))
    }
    return [...map].map(([id, value]) => ({
      id,
      name: value.name,
      conversions: value.conversions,
      revenue: value.revenue,
      reward: value.reward,
      missingReward: value.missingReward,
      prevReward: prevMonthKey == null || inPrevPeriod.some((item) => (item.offerId ?? 'none') === id && item.rewardAmount == null) ? null : (prevMap.get(id) ?? 0),
    })).sort((a, b) => b.conversions - a.conversions || b.reward - a.reward)
  }, [inPeriod, inPrevPeriod, prevMonthKey])

  const shownAffiliates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return affiliateRows.filter((row) => !needle || row.name.toLocaleLowerCase('ja-JP').includes(needle))
  }, [affiliateRows, query])

  const shownOffers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return offerRows.filter((row) => !needle || row.name.toLocaleLowerCase('ja-JP').includes(needle))
  }, [offerRows, query])

  const exportCsv = useCallback(() => {
    const header = view === 'affiliate'
      ? ['アフィリエイター', 'いちばん多い案件', '成果', '売上', '報酬', '前の期間の報酬']
      : ['案件', '成果', '売上', '報酬', '前の期間の報酬']
    const rows = view === 'affiliate'
      ? shownAffiliates.map((row) => [row.name, row.topOfferName ?? '', row.conversions, row.revenue, row.missingReward ? '' : row.reward, row.prevReward ?? ''])
      : shownOffers.map((row) => [row.name, row.conversions, row.revenue, row.missingReward ? '' : row.reward, row.prevReward ?? ''])
    const csv = [header, ...rows].map((line) => line.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `affiliate-report-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [view, shownAffiliates, shownOffers])

  const csvDisabled = state !== 'ready' || (view === 'affiliate' ? shownAffiliates : shownOffers).length === 0

  useEffect(() => {
    registerHeaderActions(
      <Button key="csv" type="button" onClick={exportCsv} disabled={csvDisabled}>
        <Download size={15} aria-hidden="true" /> CSV で書き出す
      </Button>,
    )
    return () => registerHeaderActions(null)
  }, [registerHeaderActions, exportCsv, csvDisabled])

  const listState = state === 'error' ? 'error'
    : state === 'loading' ? 'loading'
    : (view === 'affiliate' ? shownAffiliates : shownOffers).length === 0
      ? (affiliates.length === 0 && offerRows.length === 0 ? 'empty' : 'zero')
      : 'ready'

  const diffText = (reward: number, prev: number | null, conversions: number): string | null => {
    if (conversions === 0) return null
    if (reward === 0) return '計測のみ'
    if (prev == null) return null
    if (prev === 0 && reward > 0) return '（初めて）'
    const diff = reward - prev
    if (diff === 0) return '（±¥0）'
    return `（${diff > 0 ? '+' : '−'}¥${formatNumber(Math.abs(diff))}）`
  }

  const openDrawer = (id: string) => {
    const affiliate = affiliates.find((a) => a.id === id)
    if (!affiliate) return
    setDrawerRow({ ...affiliate, totalClicks: 0, totalConversions: 0, totalRevenue: 0, rewardAmount: 0, linkCount: 0, friendAdds: 0 })
  }

  return (
    <>
      <KpiStrip>
        <KpiCell
          icon={<Medal size={14} aria-hidden="true" />}
          label="成果"
          value={state === 'ready' ? inPeriod.length : null}
          unit="件"
          sub={state === 'ready' && period !== 'all' ? `先月より ${inPeriod.length - prevConversions >= 0 ? '+' : '−'}${formatNumber(Math.abs(inPeriod.length - prevConversions))}` : state === 'loading' ? '読み込んでいます' : state === 'error' ? '読み込めませんでした' : '期間内に認めた成果'}
          info="期間内に認めた成果の数です。承認待ちや却下は含みません。"
        />
        <KpiCell
          icon={<TrendingUp size={14} aria-hidden="true" />}
          label="売上"
          value={state === 'ready' ? formatYen(totalRevenue) : null}
          sub={state === 'ready' ? '成果になった注文の合計' : state === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
          info="認めた成果についた金額（成果額）の合計です。"
        />
        <KpiCell
          icon={<BarChart3 size={14} aria-hidden="true" />}
          label="報酬"
          value={state === 'ready' && !hasMissingReward ? formatYen(totalReward) : null}
          sub={state === 'ready' ? (hasMissingReward ? '未確定の報酬があります' : totalRevenue > 0 ? `売上の ${(totalReward / totalRevenue * 100).toFixed(1)}%` : '売上なし') : state === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
          info="認めた成果に確定した報酬の合計です。"
        />
        <KpiCell
          label="1件あたりの報酬"
          value={state === 'ready' && !hasMissingReward ? formatYen(perItem) : null}
          sub={state === 'ready' ? (hasMissingReward ? '未確定の報酬があります' : period === 'all' ? '成果1件あたりの平均' : hasMissingPreviousReward ? '先月の報酬は未確定です' : `先月 ${formatYen(prevPerItem)}`) : state === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
          info="報酬の合計 ÷ 認めた成果の数です。"
        />
      </KpiStrip>

      <NoticeBar>
        期間は{monthLabel(period)}。数は「認めた成果」だけ。{hasMissingReward ? "未確定の報酬は金額を表示せず、CSVも空欄にしています。" : null}成果地点ごとのレポートは「分析 › レポート」で見られます。
      </NoticeBar>

      <div className="af-list-tools">
        <SearchField
          placeholder="名前で探す"
          aria-label="名前で探す"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          className="af-list-toolsSearch"
        />
        <FilterChip selected={view === 'affiliate'} onChange={() => setView('affiliate')}>アフィリエイターごと</FilterChip>
        <FilterChip selected={view === 'offer'} onChange={() => setView('offer')}>案件ごと</FilterChip>
        <span className="af-list-toolsSpacer" />
        <Select
          aria-label="よく使う絞り込み"
          value=""
          options={[
            { value: '', label: 'よく使う絞り込み' },
            { value: 'affiliate-this', label: 'アフィリエイターごと・今月' },
            { value: 'offer-this', label: '案件ごと・今月' },
            { value: 'affiliate-last', label: 'アフィリエイターごと・先月' },
            { value: 'offer-last', label: '案件ごと・先月' },
          ]}
          onChange={(value) => {
            if (value === 'affiliate-this') { setView('affiliate'); setPeriod('this_month') }
            else if (value === 'offer-this') { setView('offer'); setPeriod('this_month') }
            else if (value === 'affiliate-last') { setView('affiliate'); setPeriod('last_month') }
            else if (value === 'offer-last') { setView('offer'); setPeriod('last_month') }
          }}
        />
        <Select
          aria-label="よく使う絞り込み"
          value=""
          options={[
            { value: '', label: 'よく使う絞り込み' },
            { value: 'affiliate-this', label: 'アフィリエイターごと・今月' },
            { value: 'offer-this', label: '案件ごと・今月' },
            { value: 'affiliate-last', label: 'アフィリエイターごと・先月' },
            { value: 'offer-last', label: '案件ごと・先月' },
          ]}
          onChange={(value) => {
            if (value === 'affiliate-this') { setView('affiliate'); setPeriod('this_month') }
            else if (value === 'offer-this') { setView('offer'); setPeriod('this_month') }
            else if (value === 'affiliate-last') { setView('affiliate'); setPeriod('last_month') }
            else if (value === 'offer-last') { setView('offer'); setPeriod('last_month') }
          }}
        />
        <Select
          aria-label="期間"
          value={period}
          options={[
            { value: 'this_month', label: monthLabel('this_month') },
            { value: 'last_month', label: monthLabel('last_month') },
            { value: 'all', label: 'すべての期間' },
          ]}
          onChange={(value) => setPeriod(value as PeriodKey)}
        />
      </div>

      {listState === 'error' ? (
        <><LoadError name="レポート" onRetry={() => { void load() }} /><Notice tone="danger" message={loadError} /></>
      ) : listState === 'loading' ? (
        <LoadingRows />
      ) : listState === 'empty' ? (
        <EmptyState
          icon={<BarChart3 size={20} aria-hidden="true" />}
          title="まだレポートに出せる成果がありません"
          description="成果を認めると、アフィリエイターごと・案件ごとのまとめがここに出ます。"
        />
      ) : listState === 'zero' ? (
        <ZeroResultState onReset={() => { setQuery(''); setPeriod('all') }} />
      ) : view === 'affiliate' ? (
        <div className="af-list-tableWrap">
          <div className="af-list-tableScroll">
            <table className="af-list-table">
              <thead>
                <tr>
                  <th>アフィリエイター（いちばん多い案件）</th>
                  <th className="af-list-numRight">成果・売上</th>
                  <th className="af-list-numRight">報酬{period !== 'all' ? '（先月より）' : ''}</th>
                  <th aria-label="操作" className="af-list-numRight" />
                </tr>
              </thead>
              <tbody>
                {shownAffiliates.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="af-list-personName" title={row.name} onClick={() => openDrawer(row.id)}>
                        {row.name}
                      </button>
                      <span className="af-list-cellSub">{row.topOfferName ?? '—'}</span>
                    </td>
                    <td className="af-list-numRight">
                      <strong>{formatNumber(row.conversions)}件</strong>
                      <span className="af-list-cellSub">{row.conversions > 0 ? formatYen(row.revenue) : '—'}</span>
                    </td>
                    <td className="af-list-numRight">
                      {row.conversions === 0 || row.missingReward ? '—' : row.reward === 0 ? '計測のみ' : (
                        <strong>{row.missingReward ? '—' : formatYen(row.reward)} <span style={{ fontWeight: 400, color: 'var(--color-ink-faint)', fontSize: 11 }}>{row.missingReward ? null : diffText(row.reward, row.prevReward, row.conversions)}</span></strong>
                      )}
                    </td>
                    <td>
                      <div className="af-list-rowActions">
                        <span style={{ position: 'relative', display: 'inline-flex' }}>
                          <MoreAction
                            label={`${row.name}のその他操作`}
                            aria-expanded={rowMenuId === row.id}
                            onClick={() => setRowMenuId((cur) => (cur === row.id ? null : row.id))}
                          />
                          <ActionMenu
                            open={rowMenuId === row.id}
                            ariaLabel={`${row.name}の操作`}
                            onClose={() => setRowMenuId(null)}
                            items={([
                              { id: 'view', label: '成果を見る', onSelect: () => openDrawer(row.id) },
                            ] satisfies ActionMenuItem[])}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="af-list-tableWrap">
          <div className="af-list-tableScroll">
            <table className="af-list-table">
              <thead>
                <tr>
                  <th>案件</th>
                  <th className="af-list-numRight">成果・売上</th>
                  <th className="af-list-numRight">報酬{period !== 'all' ? '（先月より）' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {shownOffers.map((row) => (
                  <tr key={row.id}>
                    <td><span className="af-list-cellMain" style={{ fontWeight: 600, color: 'var(--color-accent-deep)' }}>{row.name}</span></td>
                    <td className="af-list-numRight">
                      <strong>{formatNumber(row.conversions)}件</strong>
                      <span className="af-list-cellSub">{formatYen(row.revenue)}</span>
                    </td>
                    <td className="af-list-numRight">
                      <strong>{row.missingReward ? '—' : formatYen(row.reward)} <span style={{ fontWeight: 400, color: 'var(--color-ink-faint)', fontSize: 11 }}>{row.missingReward ? null : diffText(row.reward, row.prevReward, row.conversions)}</span></strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="af-list-footNote">
        行を押すと、その人の成果の明細（いつ・どの案件・いくら）を開きます。CSVは今の期間・今の並びで書き出します。
      </p>

      {drawerRow ? (
        <AffiliateDrawerV8
          affiliate={drawerRow}
          accountId={accountId}
          canEdit={canEdit}
          startInEdit={false}
          linkBaseUrl={null}
          onClose={() => setDrawerRow(null)}
          onChanged={() => { void load() }}
          onStopRequest={() => setDrawerRow(null)}
        />
      ) : null}
    </>
  )
}
