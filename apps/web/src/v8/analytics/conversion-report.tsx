'use client'

import { ValueBarChart } from '@/components/shared/charts'
import { jstDate, jstDateOffset } from '@/lib/jst-datetime'

/*
 * ★V8 分析「成果地点ごとのレポート」（Pencil `AzrZq`・`/analytics?view=conversion-report`）。
 * 経路と成果の数の帯・道具の段（RoutesFrame）の下に、日ごとの成果の棒と成果地点ごとの表。
 * 行の「…」から 成果地点を開く・日ごとの表を見る（棒をその地点だけにする）。
 * 呼ぶ口（成果レポート・CSV）は今の画面（app/analytics/conversion-report-v8.tsx）と同じ。
 */
import { useEffect, useMemo, useState } from 'react'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { RowMenu as SharedRowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { api, type ConversionDefinitionReport } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { RoutesFrame } from './routes'
import { useReportPeriod } from '@/components/shared/period-picker'


import styles from './analytics.module.css'
import { csvFileName } from '@/lib/csv-file-name'
import { emptyValue } from '@/components/shared/empty-value'
import Notice from '@/components/shared/notice'

type Point = ConversionDefinitionReport['byDefinition'][number]

function rangeOf(days: number) {
  const now = new Date()
  return { from: jstDateOffset(1 - days, now), to: jstDate(now) }
}

function RowMenu({ point, onShowDaily }: { point: Point; onShowDaily: () => void }) {
  const router = useRouter()
  return <span className={styles.rowMenu}>
    <SharedRowMenu className={styles.rowMenuButton} label={`成果地点「${point.conversionPointName}」の操作`} items={[
      { id: 'open', label: '成果地点を開く', onSelect: () => router.push(`/conversions?pointId=${encodeURIComponent(point.conversionPointId)}`) },
      { id: 'daily', label: '日ごとの表を見る', onSelect: onShowDaily },
    ]} />
  </span>
}

export default function ConversionReportV8({ accountId }: { accountId: string }) {
  const { days, setDays, customRange, setRange, range } = useReportPeriod()
  const [attempt, setAttempt] = useState(0)
  const [report, setReport] = useState<ConversionDefinitionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [pointId, setPointId] = useState<string | null>(null)
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
  const point = report?.byDefinition.find((item) => item.conversionPointId === pointId) ?? null
  const daily = useMemo(() => {
    const rows = new Map<string, number>()
    for (const item of report?.daily ?? []) if (!pointId || item.conversionPointId === pointId) rows.set(item.day, (rows.get(item.day) ?? 0) + item.netCount)
    return [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }))
  }, [report, pointId])
  const max = Math.max(1, ...daily.map((item) => item.count))
  const exportCsv = async () => {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({ ...range, lineAccountId: accountId })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = csvFileName("成果レポート"); anchor.click(); URL.revokeObjectURL(url)
    } catch { setExportError('CSVを書き出せませんでした。もう一度お試しください。') } finally { setExporting(false) }
  }

  return <RoutesFrame customRange={customRange} onRangeChange={(value) => { setRange(value); setPointId(null) }} accountId={accountId} days={days} onDaysChange={(value) => { setDays(value); setPointId(null) }} exportCsv={() => void exportCsv()} exportDisabled={!report || exporting}>
    {() => <div className={styles.reportStack}>
      {exportError ? <Notice tone="danger" className={styles.captionNoticePlacement} >{exportError}</Notice> : null}
      {loading ? <ListState kind="loading" title="成果レポートを読み込んでいます" />
        : error ? <ListState kind="error" title={error} onRetry={() => setAttempt((value) => value + 1)} />
        : report ? <>
          <section className={styles.reportCard} aria-labelledby="conversion-daily-title">
            <div className={styles.reportHead}>
              <h2 id="conversion-daily-title" className={styles.hoursTitle}>{`日ごとの成果（${point ? point.conversionPointName : '成果地点すべて'}）`}</h2>
              <span className={styles.reportSub}>{`この${days}日 ${formatNumber(point ? point.netCount : report.kpis.netCount)} 件・前の${days}日 ${formatNumber(point ? point.previousNetCount : report.kpis.previousNetCount)} 件`}</span>
              {point ? <><span className={styles.spacer} /><Button variant="secondary" onClick={() => setPointId(null)}>すべてに戻す</Button></> : null}
            </div>
            {daily.length ? <>
              <ValueBarChart label="日ごとの成果" unit="件" items={daily.map(item=>({key:item.date,label:item.date,value:item.count}))} />
            </> : <ListState kind="empty" title="この期間の成果はありません" />}
          </section>
          <div className={styles.reportTable} role="table" aria-label="成果地点ごとの成果">
            <div className={styles.reportThead} role="row">
              <span role="columnheader" className={styles.colMain}>成果地点</span>
              <span role="columnheader" className={styles.rcol} data-w="62">この期間</span>
              <span role="columnheader" className={styles.rcol} data-w="62">前の期間</span>
              <span role="columnheader" className={styles.rcol} data-w="48">増減</span>
              <span role="columnheader" className={styles.rcol} data-w="200">いちばん多い経路</span>
              <span role="columnheader" className={styles.rcol} data-w="36"><span className={styles.srOnly}>操作</span></span>
            </div>
            {report.byDefinition.length === 0
              ? <div className={styles.emptyRow} role="row"><span role="cell">成果地点がありません</span></div>
              : report.byDefinition.map((item) => <div key={item.conversionPointId} className={styles.reportRow} role="row" data-selected={item.conversionPointId === pointId || undefined}>
                <span role="cell" className={styles.colMain}><strong className={styles.cellStrong} title={item.conversionPointName}>{item.conversionPointName}</strong></span>
                <span role="cell" className={styles.rcol} data-w="62">{`${formatNumber(item.netCount)} 件`}</span>
                <span role="cell" className={styles.rcol} data-w="62">{`${formatNumber(item.previousNetCount)} 件`}</span>
                <span role="cell" className={styles.rcol} data-w="48" data-change={item.countChange > 0 ? 'up' : item.countChange < 0 ? 'down' : undefined}>{item.countChange > 0 ? `+${formatNumber(item.countChange)}` : item.countChange < 0 ? `−${formatNumber(-item.countChange)}` : '0'}</span>
                <span role="cell" className={styles.rcol} data-w="200" title={item.routes[0]?.label}>{item.routes[0]?.label ?? emptyValue('unknown')}</span>
                <span role="cell" className={styles.rcol} data-w="36"><RowMenu point={item} onShowDaily={() => setPointId(item.conversionPointId)} /></span>
              </div>)}
          </div>
          <p className={styles.reportNote}>行の「…」から 成果地点を開く・日ごとの表を見る。コンバージョンの画面からは「レポートで見る」でここへ来ます。</p>
        </> : null}
    </div>}
  </RoutesFrame>
}
