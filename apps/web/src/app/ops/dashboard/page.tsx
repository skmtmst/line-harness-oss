'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, type OpsDashboard, type OpsDashboardPeriod, type OpsLineUnregistered } from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import { opsCall } from '@/components/ops/ops-ui'
import { PlanDonut, RevenueBars, formatBytes, formatYen, shareColor } from '@/components/ops/ops-charts'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { deltaLabel, minutesLabel } from './format'

/**
 * 運営ダッシュボード ★V6 37-2 `Xvofy`。
 *
 * 金額は「契約中プランの定価」で数える（決定 2026-09-17）。Stripe の実売上は後で差し替える。
 * 要対応の 4 行は、それぞれ契約先一覧・お問い合わせへの入口を兼ねる。
 */

const PERIODS: Array<{ key: OpsDashboardPeriod; label: string }> = [
  { key: 'month', label: '今月' },
  { key: 'prev_month', label: '先月' },
  { key: 'year', label: '今年' },
]

export default function OpsDashboardPage() {
  const [period, setPeriod] = useState<OpsDashboardPeriod>('month')
  const [data, setData] = useState<OpsDashboard | null>(null)
  const [error, setError] = useState('')
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
    <div data-design-node="Xvofy">
      <OpsPageHeader title="ダッシュボード" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-body font-bold text-ink">{label}のようす</h2>
        <div className="flex items-center gap-1.5">
          {PERIODS.map((p) => (
            <FilterChip key={p.key} selected={period === p.key} onChange={(selected) => { if (selected) setPeriod(p.key) }}>
              {p.label}
            </FilterChip>
          ))}
        </div>
        <span className="ml-auto text-micro text-ink-faint">金額は契約中プランの定価で数えています（Stripe の実売上ではありません）</span>
      </div>

      {error ? <p role="alert" className="mb-3 text-caption text-status-danger">{error}</p> : null}

      {/* 初回の読み込みに失敗したときは、各セクションが「読み込んでいます」のまま残らないよう1枚のエラー表示にまとめる。 */}
      {!data && error ? (
        <div className="mb-4 rounded-card border border-hairline bg-canvas">
          <ListState kind="error" title="ダッシュボードを表示できませんでした" onRetry={() => void load()} />
        </div>
      ) : (
      <>
      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard variant="v6" title="今月のMRR" value={null} unit="" valueText={k ? formatYen(k.mrr) : undefined} detail={k ? deltaLabel(k.mrrDelta) : '—'} loading={loading} />
        <SummaryCard variant="v6" title="契約中" value={k ? k.active : null} unit="" detail={k ? `ライト${k.byPlan.light}・スタンダード${k.byPlan.standard}・プロ${k.byPlan.pro}` : '—'} loading={loading} />
        <SummaryCard variant="v6" title="トライアル中" value={k ? k.trialing : null} unit="" detail={k ? `${label}の新規 ${k.newInPeriod}` : '—'} loading={loading} />
        <SummaryCard variant="v6" title={`${label}の解約`} value={k ? k.churnInPeriod : null} unit="" detail={k ? `解約率 ${k.churnRate.toFixed(1)}%` : '—'} badge={k && k.churnInPeriod > 0 ? '確認' : undefined} badgeTone="danger" loading={loading} />
        <div data-design-node="G0vK7"><SummaryCard variant="v6" title="今月の AI 利用" value={data?.ai?.callsThisMonth ?? null} unit="回" detail={data?.ai ? `返信の下書き${data.ai.draftsThisMonth}回・記事化${data.ai.callsThisMonth - data.ai.draftsThisMonth}回` : '—'} loading={loading} /></div>
      </div>

      {/* グラフ帯 */}
      <div className="mb-4 grid gap-4 xl:grid-cols-5">
        <section aria-label="月ごとの売上" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-3">
          <h3 className="mb-2 text-label font-bold text-ink">月ごとの売上</h3>
          {data ? <RevenueBars rows={data.revenueByMonth} /> : <ListState kind="loading" title="読み込んでいます" />}
        </section>
        <section aria-label="プラン別の契約" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-2">
          <h3 className="mb-2 text-label font-bold text-ink">プラン別の契約</h3>
          {data ? (
            <div className="flex flex-wrap items-center gap-6">
              <PlanDonut rows={data.planShare.rows} total={data.planShare.total} />
              <ul className="flex min-w-48 flex-1 flex-col gap-1.5">
                {data.planShare.rows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2 rounded-control bg-canvas-sunken px-3 py-2 text-caption text-ink">
                    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-pill" style={{ background: shareColor(row.key) }} />
                    <span>{row.label}</span>
                    <span className="ml-auto text-ink-secondary">{row.count}件 ・ {row.percent}%</span>
                  </li>
                ))}
              </ul>
              <p className="w-full text-micro text-ink-faint">トライアルは契約前です。月額の合計には入れていません。</p>
            </div>
          ) : <ListState kind="loading" title="読み込んでいます" />}
        </section>
      </div>

      {/* 要対応帯 */}
      <div className="mb-4 grid gap-4 xl:grid-cols-5">
        <section aria-label="要対応" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-3">
          <h3 className="mb-2 text-label font-bold text-ink">要対応</h3>
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
            <h3 className="text-label font-bold text-ink">お問い合わせ（チケット）</h3>
            <Link href="/ops/support" className="text-caption text-accent-deep underline-offset-2 hover:underline">すべて見る</Link>
          </div>
          {data ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="未対応" value={String(data.tickets.newCount)} />
                <MiniStat label="対応中" value={String(data.tickets.inProgressCount)} />
                <MiniStat label="平均の初回返信" value={minutesLabel(data.tickets.avgFirstReplyMinutes)} />
                <MiniStat label={`${label}クローズ`} value={String(data.tickets.closedInPeriod)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-4 py-3">
                <span className="text-caption text-ink">契約者専用LINEの登録　{data.lineRegistration.registered}人 / {data.lineRegistration.total}人</span>
                <span className="ml-auto">
                  <Button size="field" onClick={() => void openUnregistered()} disabled={data.lineRegistration.unregisteredCount === 0}>
                    未登録の{data.lineRegistration.unregisteredCount}人へ案内
                  </Button>
                </span>
              </div>
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
                <Th className="w-72">上限に近い契約先</Th>
                <Th className="w-32">プラン</Th>
                <Th className="w-40">配信通数</Th>
                <Th className="w-40">バナー生成</Th>
                <Th className="w-40">メディア容量</Th>
                <Th className="w-28">使用率</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {data.usage.map((row) => (
                <Tr key={row.tenantId}>
                  <Td><Link href={`/ops/tenants/detail?id=${encodeURIComponent(row.tenantId)}`} className="block truncate text-label font-bold text-ink hover:underline">{row.tenantName}</Link></Td>
                  <Td><span className="text-caption text-ink-secondary">{row.planLabel}</span></Td>
                  <Td><span className="text-caption text-ink">{row.messages.toLocaleString('ja-JP')} / {row.limits.messages === null ? '—' : row.limits.messages.toLocaleString('ja-JP')}</span></Td>
                  <Td><span className="text-caption text-ink">{row.bannerUnits} / {row.limits.images ?? '—'}</span></Td>
                  <Td><span className="text-caption text-ink">{formatBytes(row.mediaBytes)} / {row.limits.mediaBytes === null ? '—' : formatBytes(row.limits.mediaBytes)}</span></Td>
                  <Td>{row.usageRate >= 90 ? <Chip tone="danger">{row.usageRate}%</Chip> : row.usageRate >= 70 ? <Chip tone="warn">{row.usageRate}%</Chip> : <Chip tone="neutral">{row.usageRate}%</Chip>}</Td>
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
    </div>
  )
}

function AlertRow({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="text-caption text-ink">{label}</span>
      <span className="ml-auto">{count > 0 ? <Chip tone="danger">{count}件</Chip> : <Chip tone="neutral">0件</Chip>}</span>
      <Link href={href} className="text-micro text-accent-deep underline-offset-2 hover:underline">開く</Link>
    </li>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-canvas-sunken px-3 py-2">
      <p className="text-micro text-ink-faint">{label}</p>
      <p className="text-label font-bold text-ink">{value}</p>
    </div>
  )
}
