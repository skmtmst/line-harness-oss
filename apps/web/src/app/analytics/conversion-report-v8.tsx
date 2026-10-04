'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, type ConversionDefinitionReport } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { BarChart } from '@/components/shared/bar-chart'
import { formatNumber } from '@/lib/format'
import { analyticsWeekday } from './analytics-time'
import './readonly-v8.css'

/** 成果地点の既存APIを使う閲覧画面。コンバージョン側の旧入口も残す。 */
export default function ConversionReportV8({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30)
  const [attempt, setAttempt] = useState(0)
  const [report, setReport] = useState<ConversionDefinitionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const range = useMemo(() => {
    const to = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
    const from = new Date(`${to}T00:00:00+09:00`)
    from.setUTCDate(from.getUTCDate() - days + 1)
    return { from: from.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }), to }
  }, [days])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setReport(null)
    void api.conversions.definitionReport({ ...range, lineAccountId: accountId }).then((response) => {
      if (!active) return
      if (!response.success || !Array.isArray(response.data.byDefinition) || !Array.isArray(response.data.daily)) throw new Error()
      setReport(response.data)
    }).catch(() => { if (active) setError('成果レポートを読み込めませんでした') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accountId, range, attempt])
  const daily = useMemo(() => {
    const rows = new Map<string, number>()
    for (const item of report?.daily ?? []) rows.set(item.day, (rows.get(item.day) ?? 0) + item.netCount)
    return [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ key: date, axisLabel: `${date.slice(5).replace('-', '/')}（${analyticsWeekday(date)}）`, tooltipTitle: date, added: count, removed: 0 }))
  }, [report])
  const exportCsv = async () => {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({ ...range, lineAccountId: accountId })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'conversion-report.csv'; anchor.click(); URL.revokeObjectURL(url)
    } catch { setExportError('CSVを書き出せませんでした。もう一度お試しください。') }
    finally { setExporting(false) }
  }
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label="成果レポートの期間" className="flex gap-2">{[7, 30, 90].map((value) => <Button key={value} variant="secondary" aria-pressed={days === value} onClick={() => setDays(value)}>{value}日</Button>)}</div><Button variant="secondary" disabled={!report || exporting} onClick={() => void exportCsv()} busy={exporting} busyLabel="書き出し中">CSVで書き出す</Button></div>
    {exportError && <p role="alert" className="text-danger text-sm">{exportError}</p>}
    {loading ? (
      <div aria-busy="true" aria-label="成果レポートを読み込んでいます">
        <DelayedSkeleton
          loading
          skeleton={(
            <div aria-hidden="true" className="flex flex-col gap-4">
              <div className="grid grid-cols-4">
                {[0, 1, 2, 3].map((tile) => (
                  <div key={tile}>
                    <Skeleton width="10ch" height="1em" />
                    <Skeleton width="14ch" height="1.6em" />
                    <Skeleton width="12ch" height="0.85em" />
                  </div>
                ))}
              </div>
              <Skeleton width="100%" height="10em" />
              <table className="mt-4 w-full">
                <thead><TableHeadRow><Th>成果地点</Th><Th align="right">この期間</Th><Th align="right">前の期間</Th><Th align="right">増減</Th><Th>いちばん多い経路</Th><Th align="right">操作</Th></TableHeadRow></thead>
                <tbody>
                  {[0, 1, 2, 3, 4].map((row) => (
                    <tr key={row}>
                      <td><Skeleton width="14ch" height="1em" /></td>
                      <td><Skeleton width="8ch" height="1em" /></td>
                      <td><Skeleton width="8ch" height="1em" /></td>
                      <td><Skeleton width="8ch" height="1em" /></td>
                      <td><Skeleton width="12ch" height="1em" /></td>
                      <td><Skeleton width="8ch" height="1em" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    ) : error ? <ListState kind="error" title={error} action={<Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>もう一度読む</Button>} /> : report && <>
      <div className="grid grid-cols-4"><KpiCard title="この期間の成果" value={report.kpis.netCount} unit="件" detail={`売上 ${formatNumber(report.kpis.netValue)}円`} /><KpiCard title="前の期間" value={report.kpis.previousNetCount} unit="件" detail={`${report.previousRange.from}〜${report.previousRange.to}`} /><KpiCard title="増減" value={report.kpis.netCount - report.kpis.previousNetCount} unit="件" detail="前の期間と比較" /><KpiCard title="1件あたり" value={report.kpis.averageNetValue} unit="円" detail="取り消し後の成果から集計" /></div>
      <section className="v8-ro-analytics-trend"><h2 className="text-base font-semibold">日ごとの成果（成果地点すべて）</h2><p className="mb-4 mt-2 text-xs text-ink-secondary">{report.range.from}〜{report.range.to}</p>{daily.length ? <BarChart items={daily} /> : <ListState kind="empty" title="この期間の成果はありません" />}</section>
      <table className="mt-4 w-full"><thead><TableHeadRow><Th>成果地点</Th><Th align="right">この期間</Th><Th align="right">前の期間</Th><Th align="right">増減</Th><Th>いちばん多い経路</Th><Th align="right">操作</Th></TableHeadRow></thead><tbody>{report.byDefinition.map((item) => <tr key={item.conversionPointId}><td className="py-3" title={item.conversionPointName}>{item.conversionPointName}</td><td className="text-right">{formatNumber(item.netCount)}件</td><td className="text-right">{formatNumber(item.previousNetCount)}件</td><td className="text-right">{formatNumber(item.countChange)}件</td><td title={item.routes[0]?.label}>{item.routes[0]?.label ?? '—'}</td><td className="text-right"><Link className="text-action" href={`/conversions?pointId=${encodeURIComponent(item.conversionPointId)}`}>成果地点を開く</Link></td></tr>)}</tbody></table>
    </>}
  </div>
}
