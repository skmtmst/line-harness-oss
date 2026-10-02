'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, type OpsDashboard, type OpsDashboardPeriod, type OpsLineUnregistered } from '@/lib/api'
import OpsPageHeader, { ReadonlyDesignNode } from '@/app/ops/readonly-header-v8'
import '@/app/ops/readonly-v8.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { opsCall } from '@/components/ops/ops-ui'
import { PlanDonut, RevenueBars, formatBytes, formatYen, shareColor } from '@/components/ops/ops-charts'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { contractDetail, minutesLabel, revenueDetail, revenueSourceLabel } from './format'
import { formatNumber } from '@/lib/format'

/**
 * 運営ダッシュボード ★V6 37-2 `Xvofy`。
 *
 * 売上は Stripe の入金実績。請求書が無い契約先だけ定価で補う。
 * 要対応の 4 行は、それぞれ契約先一覧・お問い合わせへの入口を兼ねる。
 */

const PERIODS: Array<{ key: OpsDashboardPeriod; label: string }> = [
  { key: 'month', label: '今月' },
  { key: 'prev_month', label: '先月' },
  { key: 'year', label: '今年' },
]

export default function OpsDashboardPage() {
  const theme = useAdminTheme()
  const [period, setPeriod] = useState<OpsDashboardPeriod>('month')
  const [data, setData] = useState<OpsDashboard | null>(null)
  const [error, setError] = useState('')
  const [canSyncBilling, setCanSyncBilling] = useState(false)
  const [syncingBilling, setSyncingBilling] = useState(false)
  const [billingSyncNotice, setBillingSyncNotice] = useState('')
  const [billingSyncError, setBillingSyncError] = useState('')
  const [unregistered, setUnregistered] = useState<OpsLineUnregistered | null>(null)
  const [unregisteredError, setUnregisteredError] = useState('')
  const [showUnregistered, setShowUnregistered] = useState(false)

  const load = useCallback(async () => {
    setError('')
    const res = await opsCall(api.ops.dashboard(period))
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setData(res.data)
  }, [period])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await opsCall(api.ops.me())
      if (active) setCanSyncBilling(Boolean(res.success && !res.data.readOnly))
    })()
    return () => { active = false }
  }, [])

  const syncBilling = async () => {
    setSyncingBilling(true)
    setBillingSyncNotice('')
    setBillingSyncError('')
    const res = await opsCall(api.ops.billingSync())
    if (!res.success) {
      setBillingSyncError(res.error || 'Stripe と同期できませんでした')
      setSyncingBilling(false)
      return
    }
    setBillingSyncNotice(`Stripe から ${res.data.imported} 件取り込みました（失敗 ${res.data.failed} 件）`)
    await load()
    setSyncingBilling(false)
  }

  const openUnregistered = async () => {
    setShowUnregistered(true)
    if (unregistered) return
    setUnregisteredError('')
    const res = await opsCall(api.ops.lineUnregistered())
    if (!res.success) { setUnregisteredError(res.error || '読み込めませんでした'); return }
    setUnregistered(res.data)
  }

  const k = data?.kpis ?? null
  const label = data?.periodLabel ?? '今月'
  const loading = data === null && !error

  return (
    <ReadonlyDesignNode node="CyW0E"><div data-design-node="Xvofy" className="v8-ro-ops-page v8-ro-ops-dashboard flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <OpsPageHeader title="ダッシュボード" />

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-body font-bold text-ink">{label}のようす</h2>
        <div className="flex items-center gap-1.5">
          {PERIODS.map((p) => (
            <FilterChip key={p.key} selected={period === p.key} onChange={(selected) => { if (selected) setPeriod(p.key) }}>
              {p.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {error ? <p role="alert" className="mb-3 text-caption text-danger">{error}</p> : null}

      {/* 初回の読み込みに失敗したときは、各セクションが「読み込んでいます」のまま残らないよう1枚のエラー表示にまとめる。 */}
      {!data && error ? (
        <div className="rounded-card border border-hairline bg-canvas">
          <ListState kind="error" title="ダッシュボードを表示できませんでした" onRetry={() => void load()} />
        </div>
      ) : (
      <>
      <div data-design-node="s7wSj" className="v8-ro-ops-metrics grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div data-design-node="nPbgn"><KpiCard variant="v6" title="今月の売上（入金済み）" value={null} unit="" valueText={k ? formatYen(k.revenueThisMonth) : undefined} detail={k ? revenueDetail(k.revenueDelta, k.refundsThisMonth) : '—'} loading={loading} /></div>
        <div data-design-node="BaoAQ"><KpiCard variant="v6" title="契約中の月額合計" value={null} unit="" valueText={k ? formatYen(k.contractMonthlyTotal) : undefined} detail={k ? contractDetail(k.active, k.byPlan, k.filledByListPriceCount) : '—'} loading={loading} /></div>
        <KpiCard variant="v6" title="トライアル中" value={k ? k.trialing : null} unit="" detail={k ? `${label}の新規 ${k.newInPeriod}${theme === 'v8' ? `・解約 ${k.churnInPeriod}（${k.churnRate.toFixed(1)}%）` : ''}` : '—'} loading={loading} />
        {theme !== 'v8' && <KpiCard variant="v6" title={`${label}の解約`} value={k ? k.churnInPeriod : null} unit="" detail={k ? `解約率 ${k.churnRate.toFixed(1)}%` : '—'} badge={k && k.churnInPeriod > 0 ? '確認' : undefined} badgeTone="danger" loading={loading} />}
        <div data-design-node="G0vK7"><KpiCard variant="v6" title="今月の AI 利用" value={data?.ai?.callsThisMonth ?? null} unit="回" detail={data?.ai ? `返信の下書き${data.ai.draftsThisMonth}回・記事化${data.ai.callsThisMonth - data.ai.draftsThisMonth}回` : '—'} loading={loading} /></div>
      </div>

      {/* グラフ帯 */}
      <div className="v8-ro-ops-dashboardGroup grid gap-4 xl:grid-cols-5">
        <section data-design-node="fyib5" aria-label="月ごとの売上" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-3">
          <div data-design-node="MVufa" className="mb-2 flex items-center gap-2">
            <h3 className="text-label font-semibold text-ink">月ごとの売上</h3>
            <span data-design-node="xaUOz" className="ml-auto text-nano text-ink-faint">{data ? revenueSourceLabel(data.pricing, data.lastSyncedAt) : '—'}</span>
            {canSyncBilling ? (
              <Button data-design-node="Fo4yb" size="field" disabled={syncingBilling} onClick={() => void syncBilling()}>
                Stripe と同期
              </Button>
            ) : null}
          </div>
          {billingSyncNotice ? <p role="status" className="mb-2 text-caption text-accent-deep">{billingSyncNotice}</p> : null}
          {billingSyncError ? <p role="alert" className="mb-2 text-caption text-danger">{billingSyncError}</p> : null}
          {data ? theme === 'v8' ? <div className="v8-ro-ops-revenue"><p className="text-micro text-ink-faint">金額（円）・{data.revenueByMonth.map(row => row.label).join('、')}</p><RevenueBars rows={data.revenueByMonth} /></div> : <RevenueBars rows={data.revenueByMonth} /> : <ListState kind="loading" title="読み込んでいます" />}
        </section>
        <section aria-label="プラン別の契約" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-2">
          <h3 className="mb-2 text-label font-semibold text-ink">プラン別の契約</h3>
          {data ? (
            <div className="flex flex-wrap items-center gap-6">
              <PlanDonut rows={data.planShare.rows} total={data.planShare.total} />
              <ul className="flex min-w-48 flex-1 flex-col gap-1.5">
                {data.planShare.rows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2 rounded-control bg-canvas-sunken px-3 py-2 text-caption text-ink">
                    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-pill" style={{ background: shareColor(row.key) }} />
                    <span>{row.label}</span>
                    {/*
                      m22d: 件数は「契約中の月額合計」のカードに集約し、ここは
                      割合だけにする（同じ「1件」「2件」が4回出るため）。
                      契約先の総数は円グラフの中央、内訳の数はカードに出る。
                    */}
                    <span className="ml-auto text-ink-secondary">{row.percent}%</span>
                  </li>
                ))}
              </ul>
              <p className="w-full text-micro text-ink-faint">トライアルは契約前です。月額の合計には入れていません。</p>
            </div>
          ) : <ListState kind="loading" title="読み込んでいます" />}
        </section>
      </div>

      {/* 要対応帯 */}
      <div className="v8-ro-ops-dashboardGroup grid gap-4 xl:grid-cols-5">
        <section aria-label="要対応" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-3">
          <h3 className="mb-2 text-label font-semibold text-ink">要対応</h3>
          {data ? (
            <ul className="divide-y divide-hairline">
              <AlertRow label="決済が失敗している契約先" count={data.alerts.pastDue} href="/ops/tenants?status=past_due" />
              <AlertRow label="トライアル期限が3日以内" count={data.alerts.trialEndingSoon} href="/ops/tenants?status=trialing" />
              <AlertRow label="LINEのトークン期限が近い店舗" count={data.alerts.lineTokenExpiring} href="/ops/tenants" />
              <AlertRow label="未返信のお問い合わせ" count={data.alerts.unansweredTickets} href="/ops/support" />
            </ul>
          ) : <ListState kind="loading" title="読み込んでいます" />}
        </section>
        <section aria-label="お問い合わせ（チケット）" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-label font-semibold text-ink">お問い合わせ（チケット）</h3>
            <Link href="/ops/support" className="text-caption text-action underline-offset-2 hover:underline">すべて見る →</Link>
          </div>
          {data ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="未対応" value={String(data.tickets.newCount)} />
                <MiniStat label="対応中" value={String(data.tickets.inProgressCount)} />
                <MiniStat label="平均の初回返信" value={minutesLabel(data.tickets.avgFirstReplyMinutes)} />
                <MiniStat label={`${label}クローズ`} value={String(data.tickets.closedInPeriod)} />
              </div>
              <Notice
                tone="success"
                className="mt-3"
                message={`契約者専用LINEの登録　${data.lineRegistration.registered}人 / ${data.lineRegistration.total}人`}
                action={(
                  <Button size="field" onClick={() => void openUnregistered()} disabled={data.lineRegistration.unregisteredCount === 0}>
                    未登録の{data.lineRegistration.unregisteredCount}人へ案内
                  </Button>
                )}
              />
            </>
          ) : <ListState kind="loading" title="読み込んでいます" />}
        </section>
      </div>

      {/* 使用量の表 */}
      <section aria-label="上限に近い契約先" className="rounded-card border border-hairline bg-canvas">
        {!data ? (
          <ListState kind="loading" title="読み込んでいます" />
        ) : data.usage.length === 0 ? (
          <ListState kind="empty" title="今月はまだ使用量がありません" description="配信・バナー生成・メディア登録があると、上限に近い契約先から順に並びます。" />
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                {/*
                  契約先の列で残りを吸収し、表を枠に収める。
                  使用率は短い札なので右へ寄せ、右端の余白を左端とそろえる。
                */}
                <Th>上限に近い契約先</Th>
                <Th className="w-32">プラン</Th>
                <Th className="w-40">配信通数</Th>
                <Th className="w-40">バナー生成</Th>
                <Th className="w-40">メディア容量</Th>
                <Th className="w-28" align="right">使用率</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {data.usage.map((row) => (
                <Tr key={row.tenantId}>
                  <Td><Link href={`/ops/tenants/detail?id=${encodeURIComponent(row.tenantId)}`} className="block truncate text-label font-medium text-ink hover:underline">{row.tenantName}</Link></Td>
                  <Td><span className="text-caption text-ink-secondary">{row.planLabel}</span></Td>
                  <Td><span className="text-caption text-ink">{formatNumber(row.messages)} / {row.limits.messages === null ? '—' : formatNumber(row.limits.messages)}</span></Td>
                  <Td><span className="text-caption text-ink">{row.bannerUnits} / {row.limits.images ?? '—'}</span></Td>
                  <Td><span className="text-caption text-ink">{formatBytes(row.mediaBytes)} / {row.limits.mediaBytes === null ? '—' : formatBytes(row.limits.mediaBytes)}</span></Td>
                  <Td align="right">{row.usageRate >= 90 ? <Chip tone="danger">{row.usageRate}%</Chip> : row.usageRate >= 70 ? <Chip tone="warn">{row.usageRate}%</Chip> : <Chip tone="neutral">{row.usageRate}%</Chip>}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      </>
      )}

      <Dialog
        open={showUnregistered}
        title="契約者専用LINEに未登録の権限者"
        description="契約者専用LINEの案内は、お知らせ配信（37-7）の LINE の口ができてから、ここから送れるようにします。いまは対象の人を確かめられます。"
        onCancel={() => setShowUnregistered(false)}
      >
        {unregistered ? (
          unregistered.people.length === 0 ? (
            <p className="text-caption text-ink-secondary">未登録の人はいません。</p>
          ) : (
            <ul className="max-h-72 divide-y divide-hairline overflow-y-auto">
              {unregistered.people.map((p) => (
                <li key={p.staffId} className="flex items-center gap-2 py-2 text-caption text-ink">
                  <span className="font-bold">{p.name}</span>
                  <span className="text-ink-secondary">{p.tenantName}</span>
                  {p.hasEmail ? null : <Chip tone="warn">メール未登録</Chip>}
                </li>
              ))}
            </ul>
          )
        ) : unregisteredError ? (
          <ListState kind="error" title="未登録の人を表示できませんでした" description={unregisteredError} onRetry={() => void openUnregistered()} />
        ) : <ListState kind="loading" title="読み込んでいます" />}
      </Dialog>
    </div></ReadonlyDesignNode>
  )
}

function AlertRow({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="text-caption text-ink">{label}</span>
      <span className="ml-auto">{count > 0 ? <Chip tone="danger">{count}件</Chip> : <Chip tone="neutral">0件</Chip>}</span>
      <Link href={href} className="text-micro text-action underline-offset-2 hover:underline">開く</Link>
    </li>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-canvas-sunken px-3 py-2">
      <p className="text-micro text-ink-faint">{label}</p>
      <p className="text-label font-medium text-ink">{value}</p>
    </div>
  )
}
