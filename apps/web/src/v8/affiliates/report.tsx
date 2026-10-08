'use client'

/*
 * ★V8 成果とアフィリエイト「レポート」（板 `Eo56k`）。
 *
 * app/affiliates/v8-report-tab.tsx から動きを写し、見た目を一覧の型（ListPage）で組み直した。
 * 数えるのは「認めた成果」だけ（承認の全件読み）。期間は今月・先月・すべて。
 * アフィリエイターごと・案件ごとの2つの見方。行（名前）を押すとその人の詳細の引き出し（tnTn9）。
 * 取得の上限を超えたら、合計を出さずに知らせる（今と同じ）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, CalendarDays, Download, ListOrdered, ReceiptText, ShoppingBag, Trophy, Users } from 'lucide-react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  downloadCsv,
  formatYen,
  jstMonthKey,
  listAllConversionApprovals,
  reportMonthKey,
  reportPeriodLabel,
  type AffiliateItem,
  type AffiliateListRow,
  type ReportPeriod,
} from './display'
import AffiliateDrawer from './drawer'
import { AffiliateArchiveDialog } from './dialogs'
import { AffiliateFrame, useAffiliateShell } from './frame'
import { AffiliateToolbar, RetryButton, RowMenu, SavedSelect, StateCard, ToolbarNotices } from './parts'
import styles from './affiliates.module.css'

type ViewKey = 'affiliate' | 'offer'

interface Agg {
  id: string
  name: string
  sub: string | null
  conversions: number
  revenue: number
  reward: number
  missingReward: boolean
  prevReward: number | null
}

const SAVED_VIEWS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'affiliate-this', label: 'アフィリエイターごと・今月' },
  { value: 'offer-this', label: '案件ごと・今月' },
  { value: 'affiliate-last', label: 'アフィリエイターごと・先月' },
  { value: 'offer-last', label: '案件ごと・先月' },
]

export default function ReportTab() {
  const router = useRouter()
  const { readonly, narrow, accountId } = useAffiliateShell()
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [affiliates, setAffiliates] = useState<AffiliateItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewKey>('affiliate')
  const [period, setPeriod] = useState<ReportPeriod>('this_month')
  const [saved, setSaved] = useState('')
  /* 見方の札を押したか（はじめはアフィリエイターごとで、どちらの札も押していない形）。 */
  const [viewPicked, setViewPicked] = useState(false)
  const [drawerRow, setDrawerRow] = useState<AffiliateListRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setState('loading')
    setLoadError('')
    try {
      const [approved, affiliatesRes] = await Promise.all([listAllConversionApprovals('approved', 0, { accountId }), api.affiliates.list()])
      if (!affiliatesRes.success) throw new Error('紹介者を読み込めませんでした。集計は出していません。')
      if (approved.truncated) throw new Error('成果が取得の上限を超えています。全件を数えられないため、合計とCSVは出していません。')
      if (seq !== requestSeq.current) return
      setItems(approved.items)
      setAffiliates(affiliatesRes.data as unknown as AffiliateItem[])
      setState('ready')
    } catch (caught) {
      if (seq !== requestSeq.current) return
      setState('error')
      setLoadError(caught instanceof Error ? caught.message : 'レポートを読み込めませんでした。')
    }
  }, [accountId])

  useEffect(() => {
    void load()
    return () => { requestSeq.current += 1 }
  }, [load, accountId])

  const monthKey = period === 'this_month' ? reportMonthKey(0) : period === 'last_month' ? reportMonthKey(-1) : null
  const prevMonthKey = monthKey ? reportMonthKey(period === 'this_month' ? -1 : -2) : null
  const inPeriod = useMemo(() => items.filter((item) => monthKey == null || jstMonthKey(item.createdAt) === monthKey), [items, monthKey])
  const inPrev = useMemo(() => items.filter((item) => prevMonthKey != null && jstMonthKey(item.createdAt) === prevMonthKey), [items, prevMonthKey])
  const rewardOf = (item: ConversionApprovalItem) => item.rewardAmount ?? 0

  const hasMissingReward = inPeriod.some((item) => item.rewardAmount == null)
  const hasMissingPrevReward = inPrev.some((item) => item.rewardAmount == null)
  const totalRevenue = inPeriod.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const totalReward = inPeriod.reduce((sum, item) => sum + rewardOf(item), 0)
  const prevReward = inPrev.reduce((sum, item) => sum + rewardOf(item), 0)
  const perItem = inPeriod.length === 0 ? 0 : Math.round(totalReward / inPeriod.length)
  const prevPerItem = inPrev.length === 0 ? 0 : Math.round(prevReward / inPrev.length)

  const aggregate = useCallback((keyOf: (item: ConversionApprovalItem) => string, nameOf: (item: ConversionApprovalItem) => string): Map<string, Agg & { offers: Map<string, number> }> => {
    const map = new Map<string, Agg & { offers: Map<string, number> }>()
    for (const item of inPeriod) {
      const id = keyOf(item)
      const current = map.get(id) ?? { id, name: nameOf(item), sub: null, conversions: 0, revenue: 0, reward: 0, missingReward: false, prevReward: null, offers: new Map<string, number>() }
      current.conversions += 1
      current.revenue += item.value ?? 0
      current.reward += rewardOf(item)
      current.missingReward ||= item.rewardAmount == null
      if (item.offerName) current.offers.set(item.offerName, (current.offers.get(item.offerName) ?? 0) + 1)
      map.set(id, current)
    }
    return map
  }, [inPeriod])

  const prevOf = useCallback((keyOf: (item: ConversionApprovalItem) => string, id: string): number | null => {
    if (prevMonthKey == null) return null
    const rows = inPrev.filter((item) => keyOf(item) === id)
    if (rows.some((item) => item.rewardAmount == null)) return null
    return rows.reduce((sum, item) => sum + rewardOf(item), 0)
  }, [inPrev, prevMonthKey])

  const affiliateRows = useMemo<Agg[]>(() => {
    const keyOf = (item: ConversionApprovalItem) => item.affiliateId
    const map = aggregate(keyOf, (item) => item.affiliateName ?? affiliates.find((a) => a.id === item.affiliateId)?.name ?? '名前を読み込めませんでした')
    /* 期間に成果が無い人も「0件」で並べる。 */
    for (const affiliate of affiliates) {
      if (!map.has(affiliate.id)) map.set(affiliate.id, { id: affiliate.id, name: affiliate.name, sub: null, conversions: 0, revenue: 0, reward: 0, missingReward: false, prevReward: null, offers: new Map() })
    }
    return [...map.values()].map((row) => ({
      ...row,
      sub: [...row.offers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      prevReward: prevOf(keyOf, row.id),
    })).sort((a, b) => b.conversions - a.conversions || b.reward - a.reward)
  }, [affiliates, aggregate, prevOf])

  const offerRows = useMemo<Agg[]>(() => {
    const keyOf = (item: ConversionApprovalItem) => item.offerId ?? 'none'
    const map = aggregate(keyOf, (item) => item.offerName ?? '案件は未設定')
    return [...map.values()].map((row) => {
      const people = new Set(inPeriod.filter((item) => keyOf(item) === row.id).map((item) => item.affiliateId)).size
      return { ...row, sub: `${formatNumber(people)}人が紹介`, prevReward: prevOf(keyOf, row.id) }
    }).sort((a, b) => b.conversions - a.conversions || b.reward - a.reward)
  }, [aggregate, inPeriod, prevOf])

  const rows = view === 'affiliate' ? affiliateRows : offerRows
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return rows.filter((row) => !needle || row.name.toLocaleLowerCase('ja-JP').includes(needle))
  }, [query, rows])

  const ready = state === 'ready'

  const exportCsv = () => {
    downloadCsv(`affiliate-report-${new Date().toISOString().slice(0, 10)}.csv`, view === 'affiliate'
      ? [['アフィリエイター', 'いちばん多い案件', '成果', '売上', '報酬', '前の期間の報酬'], ...shown.map((row) => [row.name, row.sub ?? '', row.conversions, row.revenue, row.missingReward ? '' : row.reward, row.prevReward ?? ''])]
      : [['案件', '成果', '売上', '報酬', '前の期間の報酬'], ...shown.map((row) => [row.name, row.conversions, row.revenue, row.missingReward ? '' : row.reward, row.prevReward ?? ''])])
  }

  const rewardText = (row: Agg): string => {
    if (row.conversions === 0 || row.missingReward) return '—'
    if (row.reward === 0) return '計測のみ'
    const base = formatYen(row.reward)
    if (period === 'all' || row.prevReward == null) return base
    if (row.prevReward === 0) return `${base}（初めて）`
    const diff = row.reward - row.prevReward
    if (diff === 0) return `${base}（±¥0）`
    return `${base}（${diff > 0 ? '+' : '−'}¥${formatNumber(Math.abs(diff))}）`
  }

  const openDrawer = (id: string) => {
    const affiliate = affiliates.find((a) => a.id === id)
    if (!affiliate) return
    const agg = affiliateRows.find((row) => row.id === id)
    setDrawerRow({ ...affiliate, totalClicks: 0, totalConversions: agg?.conversions ?? 0, totalRevenue: agg?.revenue ?? 0, rewardAmount: agg?.reward ?? 0, linkCount: 0, friendAdds: 0 })
  }

  const loadingWord = '読み込んでいます'
  const errorWord = '読み込めませんでした'
  const conversionsDelta = inPeriod.length - inPrev.length
  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="成果"
        icon={<Trophy size={14} aria-hidden="true" />}
        value={ready ? inPeriod.length : null}
        unit="件"
        detail={ready ? (period === 'all' ? '期間内に認めた成果' : conversionsDelta === 0 ? '先月と同じ' : `先月より ${conversionsDelta > 0 ? '+' : '−'}${formatNumber(Math.abs(conversionsDelta))}`) : state === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="売上"
        icon={<ShoppingBag size={14} aria-hidden="true" />}
        value={null}
        valueText={ready ? formatYen(totalRevenue) : '—'}
        unit=""
        detail={ready ? '成果になった注文の合計' : state === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="報酬"
        icon={<Banknote size={14} aria-hidden="true" />}
        value={null}
        valueText={ready && !hasMissingReward ? formatYen(totalReward) : '—'}
        unit=""
        detail={ready ? (hasMissingReward ? '未確定の報酬があります' : totalRevenue > 0 ? `売上の ${(totalReward / totalRevenue * 100).toFixed(1)}%` : '売上なし') : state === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="1件あたりの報酬"
        icon={<ReceiptText size={14} aria-hidden="true" />}
        value={null}
        valueText={ready && !hasMissingReward ? formatYen(perItem) : '—'}
        unit=""
        detail={ready ? (hasMissingReward ? '未確定の報酬があります' : period === 'all' ? '成果1件あたりの平均' : hasMissingPrevReward ? '先月の報酬は未確定です' : `先月 ${formatYen(prevPerItem)}`) : state === 'loading' ? loadingWord : errorWord}
      />
    </KpiBand>
  )

  const chips = (
    <div role="group" aria-label="見方" className={styles.chipGroup}>
      <FilterChip selected={view === 'affiliate' && viewPicked} icon={<Users size={13} aria-hidden="true" />} onChange={(on) => { setView('affiliate'); setViewPicked(on); setSaved('') }}>アフィリエイターごと</FilterChip>
      <FilterChip selected={view === 'offer'} icon={<ListOrdered size={13} aria-hidden="true" />} onChange={(on) => { setView(on ? 'offer' : 'affiliate'); setViewPicked(on); setSaved('') }}>案件ごと</FilterChip>
    </div>
  )

  const trailing = (
    <>
      <SavedSelect
        value={saved}
        options={SAVED_VIEWS}
        onChange={(value) => {
          setSaved(value)
          if (!value) return
          const [nextView, when] = value.split('-')
          setView(nextView === 'offer' ? 'offer' : 'affiliate')
          setPeriod(when === 'last' ? 'last_month' : 'this_month')
        }}
      />
      <div className={styles.periodBox}>
        <CalendarDays size={15} aria-hidden="true" className={styles.periodIcon} />
        <Select
          aria-label="期間"
          value={period}
          options={[
            { value: 'this_month', label: reportPeriodLabel('this_month') },
            { value: 'last_month', label: reportPeriodLabel('last_month') },
            { value: 'all', label: 'すべての期間' },
          ]}
          onChange={(value) => setPeriod(value as ReportPeriod)}
        />
      </div>
    </>
  )

  const toolbar = (
    <AffiliateToolbar
      narrow={narrow}
      notices={<ToolbarNotices
        info={`期間は${reportPeriodLabel(period)}。数は「認めた成果」だけ。${hasMissingReward ? '未確定の報酬は金額を出さず、CSVも空欄にしています。' : ''}成果地点ごとのレポートは「分析 › レポート」で見られます。`}
        error={state === 'error' ? loadError : undefined}
      />}
      search={{ placeholder: view === 'affiliate' ? '名前で探す' : '案件名で探す', value: query, onChange: setQuery }}
      chips={chips}
      trailing={trailing}
    />
  )

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={`${styles.table} ${styles.tableReport}`}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>{view === 'affiliate' ? 'アフィリエイター（いちばん多い案件）' : '案件（紹介した人の数）'}</Th>
            <Th className={styles.colRepConv}>成果・売上</Th>
            <Th className={styles.colRepReward}>{period === 'all' ? '報酬' : '報酬（先月より）'}</Th>
            <Th className={styles.colRepOps}><span className={styles.srOnly}>操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {shown.map((row) => (
            <Tr key={row.id} className={styles.row} data-table-layout="columns">
              <Td className={styles.colName}>
                <span className={styles.stack}>
                  {view === 'affiliate' ? (
                    <button type="button" className={styles.rowLink} title={row.name} onClick={() => openDrawer(row.id)}>{row.name}</button>
                  ) : (
                    <span className={styles.rowLinkText} title={row.name}>{row.name}</span>
                  )}
                  <span className={styles.rowPlan}>{row.sub ?? '—'}</span>
                </span>
              </Td>
              <Td className={styles.colRepConv}>
                <span className={styles.stack}>
                  <span className={styles.cellMain}>{`${formatNumber(row.conversions)}件`}</span>
                  <span className={styles.rowPlan}>{row.conversions > 0 && row.revenue > 0 ? formatYen(row.revenue) : '—'}</span>
                </span>
              </Td>
              <Td className={styles.colRepReward}><span className={styles.cellStrong}>{rewardText(row)}</span></Td>
              <Td className={styles.colRepOps}>
                {view === 'affiliate' ? (
                  <RowMenu
                    label={`${row.name}の操作`}
                    items={[
                      { id: 'view', label: '成果を見る', onSelect: () => openDrawer(row.id) },
                      { id: 'approvals', label: 'この人の成果承認を開く', external: true, onSelect: () => router.push(`/affiliates?tab=approvals&affiliate=${encodeURIComponent(row.id)}`) },
                    ]}
                  />
                ) : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  )

  const body = state === 'loading' ? (
    <ListState kind="loading" title="レポートを読み込んでいます" />
  ) : state === 'error' ? (
    <StateCard tone="error" title="レポートを読み込めませんでした" description={loadError || '数の帯は「—」にしています。道具はそのまま使えます。'} action={<RetryButton onRetry={() => { void load() }} />} />
  ) : rows.length === 0 ? (
    <StateCard icon={<Trophy size={16} aria-hidden="true" />} title="この期間の成果はありません" description="期間を変えると、ほかの月の成果が出ます" action={<Button type="button" onClick={() => setPeriod('all')}>すべての期間にする</Button>} />
  ) : shown.length === 0 ? (
    <StateCard title="条件に合うものはありません" description="検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={() => setQuery('')}>条件を外す</Button>} />
  ) : (
    <>
      {table}
      <p className={styles.footNote}>
        {view === 'affiliate'
          ? '行を押すと、その人の成果の明細（いつ・どの案件・いくら）を開きます。CSV は今の期間・今の並びで書き出します。'
          : '案件ごとの成果・売上・報酬です。CSV は今の期間・今の並びで書き出します。'}
      </p>
    </>
  )

  return (
    <AffiliateFrame
      actions={<Button onClick={exportCsv} disabled={!ready || shown.length === 0}><Download size={15} aria-hidden="true" /> CSV で書き出す</Button>}
      stats={stats}
      toolbar={toolbar}
      overlays={<>
        {drawerRow ? (
          <AffiliateDrawer
            affiliate={drawerRow}
            accountId={accountId}
            readonly={readonly}
            startInEdit={false}
            linkBaseUrl={null}
            onClose={() => setDrawerRow(null)}
            onChanged={() => { void load() }}
            onStopRequest={(id, name) => setArchiveTarget({ id, name })}
          />
        ) : null}
        <AffiliateArchiveDialog target={archiveTarget} onClose={() => setArchiveTarget(null)} onChanged={() => { void load() }} />
      </>}
    >
      {body}
    </AffiliateFrame>
  )
}
