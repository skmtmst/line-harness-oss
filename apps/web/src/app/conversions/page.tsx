'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import KpiCard from '@/components/dashboard/kpi-card'

/**
 * 数え方を運用者の言葉にする。既定（manual）も省略せずに出す。
 *
 * 設計は「指定ページへの到達 / EC連携からの通知」と、何が起きたら数えるのかを
 * そのまま書いている。「URL到達」だと、誰がどのURLに来たときの話なのかが
 * 読み取れない。
 */
function measureLabel(method: ConversionPoint['measureMethod']): string {
  if (method === 'url_reach') return '指定ページへの到達'
  if (method === 'webhook') return 'EC連携からの通知'
  return '手動で記録'
}

/**
 * 種別を運用者の言葉にする。
 *
 * 設計は「購入」「申込・登録」の2つでまとめている。実装の eventType は9種
 * あるので、設計の2つに寄せられるものは寄せ、残りはそのまま出す。
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  purchase: '購入',
  form_submit: '申込・登録',
  friend_add: '申込・登録',
  visit: '来店・参加',
  // 作る画面が以前に送っていた値。過去に作った行がこれで残っている。
  signup: '申込・登録',
  reserve: '来店・参加',
  other: 'その他',
  scenario_step: 'シナリオ到達',
  rich_menu_tap: 'リッチメニュー',
  url_click: 'URLクリック',
  keyword_sent: 'キーワード',
  liff_view: 'LIFF閲覧',
  custom: 'その他',
  ec_order_confirmed: '購入',
  ec_subscription_confirmed: '購入',
  form_submitted: '申込・登録',
  reservation_confirmed: '来店・参加',
  webinar_completed: 'その他',
}

import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { AffiliatorsTab, OffersTab, ApprovalQueue } from '@/app/affiliates/tabs'
import AffiliatePaymentTab from '@/app/affiliates/payment-tab'
import { useAccount } from '@/contexts/account-context'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import ConfirmDialog from '@/components/shared/confirm-dialog'

interface ConversionReportItem {
  conversionPointId: string
  conversionPointName: string
  eventType: string
  totalCount: number
  totalValue: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function reportRange(days: number, previous = false): { startDate: string; endDate: string } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  if (previous) end.setTime(end.getTime() - days * DAY_MS)
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  start.setHours(0, 0, 0, 0)
  return { startDate: start.toISOString(), endDate: end.toISOString() }
}

function rangeLabel(days: number): string {
  const { startDate, endDate } = reportRange(days)
  const format = (value: string) => {
    const date = new Date(value)
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
  return `この${days}日（${format(startDate)}〜${format(endDate)}）`
}

function sourceTriggerLabel(point: ConversionPoint): string {
  if (point.measureMethod === 'url_reach') {
    return point.targetUrl ? `サイトの「${point.targetUrl}」に到達` : '指定したページに到達'
  }
  if (point.measureMethod === 'webhook') {
    if (point.eventType === 'purchase' || point.eventType === 'ec_order_confirmed') return 'EC連携から注文確定の通知を受信'
    if (point.eventType === 'ec_subscription_confirmed') return 'EC連携から定期便確定の通知を受信'
    if (point.eventType === 'form_submit' || point.eventType === 'form_submitted') return '回答フォームから送信完了の通知を受信'
    if (point.eventType === 'visit' || point.eventType === 'reservation_confirmed') return '予約管理から予約確定の通知を受信'
    if (point.eventType === 'webinar_completed') return 'ウェビナーから視聴完了の通知を受信'
    return '接続したシステムから成果の通知を受信'
  }
  return '管理画面から担当者が記録'
}

/**
 * 設計 6-1 は1画面に5タブ。並びは設計のまま、素のURLでは主役の
 * 「成果地点（CV）」を開く。
 *
 * これまでは /conversions が2タブ、その中に入れていた /affiliates が
 * さらに3タブを持つ二重構造だった。同じ ?tab= が2つの意味を持つので、
 * 「案件を開くURL」を人に送れなかった。
 */
const MERGED_TABS = [
  { key: 'affiliates', label: 'アフィリエイター' },
  { key: 'offers', label: '案件' },
  { key: 'approvals', label: '成果承認' },
  { key: 'points', label: '成果地点' },
  { key: 'report', label: 'レポート' },
  /*
    **「支払い」を戻した。** 設計 `njLGA`（16-1-C）はこのタブを持つのに、
    `MERGED_TABS` に無かったので `?tab=payment` は既定タブへ落ち、
    **画面からは「無い」ことすら分からなかった**（#739 で未実装と判定した）。
    口は #763 で入ったので、読むだけの面をつなぐ。
  */
  { key: 'payment', label: '支払い' },
]

const DEFAULT_TAB = 'points'

/**
 * 並び順。**どれも読み込んだ行から数えられるものだけ**にしてある。
 * 設計は「CV数が多い順」しか描いていないが、CV数はレポートから引けるので
 * 実際に並べ替えられる。作れない並び（報酬順など）は足さない。
 */
type PointSort = 'cv-desc' | 'value-desc' | 'name'

const SORT_OPTIONS: Array<{ value: PointSort; label: string }> = [
  { value: 'cv-desc', label: 'CV数が多い順' },
  { value: 'value-desc', label: '成果単価が高い順' },
  { value: 'name', label: '成果地点名順' },
]

const PAGE_SIZE = 20

function ConversionsPageInner() {
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [report, setReport] = useState<ConversionReportItem[]>([])
  const [previousReport, setPreviousReport] = useState<ConversionReportItem[]>([])
  const [reportAvailable, setReportAvailable] = useState(false)
  const [previousReportAvailable, setPreviousReportAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PointSort>('cv-desc')
  const [page, setPage] = useState(1)
  // 成果地点そのものが引けなかったときだけ「読み込めませんでした」を出す。
  // KPI に使う承認・案件が落ちても、表は出せる。
  const [loadFailed, setLoadFailed] = useState(false)
  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らない。成果地点を消すと、記録した成果もまとめて消える。
   * それを本文で読ませたいので、共通の `ConfirmDialog` へ移した。
   *
   * この画面はヘッダーのLINEアカウントを見ていない（`/api/conversions/points`
   * はアカウントで絞らない）ので、押した時点のアカウントを窓に固定する必要は
   * ない。
   */
  const [deleteTarget, setDeleteTarget] = useState<ConversionPoint | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadFailed(false)
    setPoints([])
    setReport([])
    setPreviousReport([])
    setReportAvailable(false)
    setPreviousReportAvailable(false)
    try {
      const [pointsRes, reportRes, previousRes] = await Promise.allSettled([
        api.conversions.points(),
        api.conversions.report(reportRange(30)),
        api.conversions.report(reportRange(30, true)),
      ])
      if (pointsRes.status === 'fulfilled' && pointsRes.value.success && Array.isArray(pointsRes.value.data)) {
        setPoints(pointsRes.value.data)
      }
      else setLoadFailed(true)
      if (reportRes.status === 'fulfilled' && reportRes.value.success && Array.isArray(reportRes.value.data)) {
        setReport(reportRes.value.data)
        setReportAvailable(true)
      }
      if (previousRes.status === 'fulfilled' && previousRes.value.success && Array.isArray(previousRes.value.data)) {
        setPreviousReport(previousRes.value.data)
        setPreviousReportAvailable(true)
      }
    } catch {
      setLoadFailed(true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  /**
   * 成果地点を消す。
   *
   * 処理中は受け付けない（二度押しで2回叩くと、2回目は404になって
   * 「消せませんでした」と出る。消えているのに失敗に見える）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。
   */
  const runDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.conversions.deletePoint(deleteTarget.id)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      await load()
    } catch {
      setDeleteError('この成果地点を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  // 成果地点ごとのCV数。レポートは成果地点IDで返る。
  const countByPoint = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of report) m.set(r.conversionPointId, r.totalCount)
    return m
  }, [report])

  const kpi = useMemo(() => {
    const currentCount = report.reduce((sum, row) => sum + row.totalCount, 0)
    const previousCount = previousReport.reduce((sum, row) => sum + row.totalCount, 0)
    return {
      currentCount,
      previousCount,
      currentValue: report.reduce((sum, row) => sum + row.totalValue, 0),
      zeroCount: report.filter((row) => row.totalCount === 0).length,
    }
  }, [previousReport, report])

  const shown = useMemo(() => {
    const q = query.trim()
    const matched = q ? points.filter((p) => p.name.includes(q)) : points
    return matched.toSorted((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'ja')
      if (sort === 'value-desc') return (right.value ?? 0) - (left.value ?? 0)
      if (!reportAvailable) return 0
      return (countByPoint.get(right.id) ?? 0) - (countByPoint.get(left.id) ?? 0)
    })
  }, [countByPoint, points, query, reportAvailable, sort])

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = useMemo(
    () => shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, shown],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div data-conversion-points-design="v6">

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="決めてある成果地点"
          value={points.length}
          unit="個"
          detail="現在表示できる成果地点"
          loading={loading}
        />
        <KpiCard
          title="この30日の成果"
          value={reportAvailable ? kpi.currentCount : null}
          unit="件"
          detail={reportAvailable
            ? previousReportAvailable
              ? `前の30日 ${kpi.previousCount.toLocaleString()}件`
              : '前の30日の比較は読み込めませんでした'
            : '集計を読み込めませんでした'}
          loading={loading}
        />
        <KpiCard
          title="金額がついた成果"
          value={reportAvailable ? kpi.currentValue : null}
          unit="円"
          detail="この30日に記録された金額"
          loading={loading}
        />
        <KpiCard
          title="1件も起きていない"
          value={reportAvailable ? kpi.zeroCount : null}
          unit="個"
          detail="この30日に確認が必要な成果地点"
          loading={loading}
        />
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value)
            setPage(1)
          }}
          onClear={() => {
            setQuery('')
            setPage(1)
          }}
          placeholder="成果地点の名前で検索"
          aria-label="成果地点の名前で検索"
          className="min-w-64 flex-1"
        />
        <Select
          aria-label="並び順"
          label="並び順"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(value) => {
            setSort(value as PointSort)
            setPage(1)
          }}
        />
        {/*
          一覧は設計の既定どおり30日に固定する。レポート画面では同じAPIへ
          期間を渡して切り替えられる。書き出しの口（CSV）はまだ無いため、
          押せない札を置かず、下で接続条件を説明する。
        */}
        <p className="text-ink-faint text-caption">
          <span className="text-ink-secondary font-medium">期間</span>{' '}
          <span className="tabular-nums">{rangeLabel(30)}</span>
        </p>
      </div>

      {/* 設計の表は7列。報酬と状態は持っている列が無いので「—」を出す。
          列ごと消すと、その考え方が無い画面に見えてしまう。 */}
      {loading ? (
        <ListState kind="loading" title="成果地点を読み込んでいます" />
      ) : loadFailed ? (
        <ListState
          kind="error"
          title="成果地点を読み込めませんでした"
          description="再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              成果地点を再読み込み
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <ListState
          kind="empty"
          title={query ? '条件に合う成果地点はありません' : 'まだ成果地点がありません'}
          description={
            query
              ? '検索の言葉を変えてください。'
              : '右上の「成果地点を追加」から登録すると、ここに出ます。'
          }
        />
      ) : (
        <div data-design="Table" className="bg-canvas rounded-card border-hairline border">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th>成果地点</Th>
                <Th>何が起きたら数えるか</Th>
                <Th align="right">この30日</Th>
                <Th align="right">金額</Th>
                <Th>使われている場所</Th>
                <Th>状態</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {current.map((point) => (
                <tr key={point.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink w-[22%] px-4 py-3 text-sm font-medium">
                    {point.name}
                    <p className="text-ink-faint mt-0.5 text-[11px]">{EVENT_TYPE_LABELS[point.eventType] ?? 'その他'}</p>
                  </td>
                  <td className="text-ink-secondary w-[30%] px-4 py-3 text-sm">
                    {sourceTriggerLabel(point)}
                    <p className="text-ink-faint mt-0.5 text-[11px]">
                      {measureLabel(point.measureMethod)}・{point.countRepeat === false ? '1人1回' : '毎回数える'}
                    </p>
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                    {reportAvailable ? `${(countByPoint.get(point.id) ?? 0).toLocaleString()}件` : '—'}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {point.value === null
                      ? '金額なし'
                      : reportAvailable
                        ? `¥${(report.find((row) => row.conversionPointId === point.id)?.totalValue ?? 0).toLocaleString()}`
                        : '—'}
                  </td>
                  <td className="text-ink-faint w-[18%] px-4 py-3 text-sm">
                    —<span className="ml-1 text-[11px]">利用先の取得は未接続</span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                      計測中
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setDeleteError('')
                        setDeleteTarget(point)
                      }}
                      className="text-danger text-sm hover:underline"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs">
          詳細を見る口と、案件・自動応答・分析などの使う場所を足す口はまだ接続されていません。接続後は各行から直接進めます。
          <br />
          書き出しはまだ繋がっていません。CSVを作る口が接続されると、この場所に操作が出ます。
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-faint tabular-nums">
            成果地点 {shown.length}個中 {shown.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}〜
            {Math.min(page * PAGE_SIZE, shown.length)}個を表示
          </span>
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        designNode="d8d3Mz"
        title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : ''}
        description="この成果地点で記録した成果も一緒に消えます。承認済み・承認待ちの成果もまとめて消え、集計から外れます。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void runDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      >
        {deleteTarget && (
          <div className="text-ink-secondary space-y-2 text-sm">
            <p>
              種別：{EVENT_TYPE_LABELS[deleteTarget.eventType] ?? deleteTarget.eventType} ／ 計測方法：
              {measureLabel(deleteTarget.measureMethod)}
            </p>
            <p>
              記録した成果：
              {reportAvailable ? (
                <span className="tabular-nums">{(countByPoint.get(deleteTarget.id) ?? 0).toLocaleString('ja-JP')}件</span>
              ) : (
                <>— 読み込めませんでした。件数が分からないまま消すことになります。</>
              )}
            </p>
            {/*
              **取れない数を作らない。**
              オートメーション（CV発火）やアフィリエイト案件がこの成果地点を
              指していても、それを数える口が無い。「0件」と書くと、参照が
              無いのか数えていないのか区別が付かなくなる。
            */}
            <p className="text-ink-faint text-xs">
              オートメーション・アフィリエイト案件からの参照は数えられていません。消したあとに参照が切れることがあります。
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}

/**
 * レポートのタブ。
 *
 * 成果地点ごとの件数と金額をそのまま出す。一覧の表にもCV数はあるが、
 * あちらは「どう数えるか」を確かめる画面で、こちらは「いくらになったか」を
 * 見る画面なので、金額を主にしている。
 */
function ReportTab() {
  const [rows, setRows] = useState<ConversionReportItem[]>([])
  const [previousRows, setPreviousRows] = useState<ConversionReportItem[]>([])
  const [periodDays, setPeriodDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [comparisonAvailable, setComparisonAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setComparisonAvailable(false)
    setRows([])
    setPreviousRows([])
    void Promise.allSettled([
      api.conversions.report(reportRange(periodDays)),
      api.conversions.report(reportRange(periodDays, true)),
    ])
      .then(([current, previous]) => {
        if (cancelled) return
        if (current.status === 'fulfilled' && current.value.success && Array.isArray(current.value.data)) {
          setRows(current.value.data)
        } else {
          setLoadFailed(true)
        }
        if (previous.status === 'fulfilled' && previous.value.success && Array.isArray(previous.value.data)) {
          setPreviousRows(previous.value.data)
          setComparisonAvailable(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [periodDays])

  const previousByPoint = useMemo(
    () => new Map(previousRows.map((row) => [row.conversionPointId, row])),
    [previousRows],
  )
  const visibleRows = useMemo(
    () => rows.filter((row) => row.totalCount > 0 || (previousByPoint.get(row.conversionPointId)?.totalCount ?? 0) > 0),
    [previousByPoint, rows],
  )
  const totalCount = rows.reduce((sum, row) => sum + row.totalCount, 0)
  const previousCount = previousRows.reduce((sum, row) => sum + row.totalCount, 0)
  const totalValue = rows.reduce((sum, row) => sum + row.totalValue, 0)
  const previousValue = previousRows.reduce((sum, row) => sum + row.totalValue, 0)
  const averageValue = totalCount > 0 ? Math.round(totalValue / totalCount) : 0
  const bestGrowth = comparisonAvailable
    ? visibleRows
        .map((row) => ({
          name: row.conversionPointName,
          growth: row.totalCount - (previousByPoint.get(row.conversionPointId)?.totalCount ?? 0),
        }))
        .toSorted((left, right) => right.growth - left.growth)[0]
    : undefined

  if (loading) {
    return <ListState kind="loading" title="成果レポートを読み込んでいます" />
  }

  if (loadFailed) {
    return (
      <ListState
        kind="error"
        title="成果レポートを読み込めませんでした"
        description="成果地点の一覧はそのまま使えます。時間を置いて、このタブを開き直してください。"
      />
    )
  }

  return (
    <div className="space-y-4" data-conversion-report-design="v6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          aria-label="集計期間"
          label="期間"
          value={String(periodDays)}
          options={[
            { value: '7', label: 'この7日' },
            { value: '30', label: 'この30日' },
            { value: '90', label: 'この90日' },
          ]}
          onChange={(value) => setPeriodDays(Number(value))}
        />
        <p className="text-ink-faint text-xs">
          CSVの書き出し口は未接続です。接続後は、選んだ期間と比較条件を含めて書き出します。
        </p>
      </div>

      <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`この${periodDays}日の成果`}
          value={totalCount}
          unit="件"
          detail={comparisonAvailable
            ? `前の${periodDays}日 ${previousCount.toLocaleString()}件`
            : `前の${periodDays}日は読み込めませんでした`}
        />
        <KpiCard
          title="金額"
          value={totalValue}
          unit="円"
          detail={comparisonAvailable
            ? `前の${periodDays}日 ¥${previousValue.toLocaleString()}`
            : `前の${periodDays}日は読み込めませんでした`}
        />
        <KpiCard
          title="1件あたり"
          value={averageValue}
          unit="円"
          detail="この期間に記録された金額 ÷ 成果件数"
        />
        <KpiCard
          title="いちばん伸びた"
          value={comparisonAvailable ? (bestGrowth?.growth ?? 0) : null}
          unit="件"
          detail={comparisonAvailable
            ? bestGrowth?.name ?? '比較できる成果はありません'
            : '比較期間を読み込めませんでした'}
        />
      </div>

      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-semibold">日ごとの成果</h2>
        <p className="text-ink-faint mt-2 text-sm">
          日別の集計口はまだ接続されていません。成果が起きた日と成果地点を日単位で返す口が接続されると、ここに積み上げグラフを表示します。
        </p>
      </section>

      <p className="text-ink-faint text-xs">
        成果地点ごとの件数を、同じ長さの直前期間と比べています。取消・純成果・未帰属は現在の集計口では区別できないため、総件数として表示しています。
      </p>

      {visibleRows.length === 0 ? (
        <ListState
          kind="empty"
          title="この期間には成果がありません"
          description="期間を変えるか、成果地点の計測状況を確認してください。"
        />
      ) : (
        <div data-design="Table" className="bg-canvas rounded-card border-hairline border">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th>成果地点</Th>
                <Th align="right">この期間</Th>
                <Th align="right">前の期間</Th>
                <Th align="right">増減</Th>
                <Th>いちばん多い経路</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {visibleRows.map((row) => {
                const before = comparisonAvailable
                  ? (previousByPoint.get(row.conversionPointId)?.totalCount ?? 0)
                  : null
                const difference = before === null ? null : row.totalCount - before
                return (
                  <tr key={row.conversionPointId} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm font-medium">
                      {row.conversionPointName}
                      <p className="text-ink-faint mt-0.5 text-[11px]">
                        {EVENT_TYPE_LABELS[row.eventType] ?? 'その他'}
                      </p>
                    </td>
                    <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                      {row.totalCount.toLocaleString()}件
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {before === null ? '—' : `${before.toLocaleString()}件`}
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference.toLocaleString()}件`}
                    </td>
                    <td className="text-ink-faint px-4 py-3 text-sm">— 帰属根拠の集計は未接続</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ConversionsPageHost() {
  const tab = useMergedTab(MERGED_TABS, 'tab', DEFAULT_TAB)
  const { selectedAccountId } = useAccount()
  /**
   * タブごとのV6実Node。5タブすべてを埋める。
   *
   * `points` と `report` が抜けていて `data-design-node={undefined}` が
   * そのまま出ていた。設計側の並びは `design-structure.json` の
   * `/conversions` に "PouPn GH8VL n5VVTb ZrpKn GUxsj" として記録がある。
   *
   * **`d8d3Mz` は「19-1-C 成果地点の削除確認」の重ね画面**であって、
   * 一覧のNodeではない（`docs/v6-requirements/v6-19-conversion-requirements-draft.md`）。
   * 一覧に付けると、削除確認の画面とNodeが二重になる。
   */
  const nodeByTab: Record<string, string | undefined> = {
    affiliates: 'PouPn',
    offers: 'GH8VL',
    approvals: 'n5VVTb',
    points: 'ZrpKn',
    report: 'GUxsj',
  }
  return (
    <div data-design-node={nodeByTab[tab]}>
      <MergedTabs
        basePath="/conversions"
        paramName="tab"
        tabs={MERGED_TABS}
        active={tab}
        defaultKey={DEFAULT_TAB}
        actions={tab === 'points' ? <Button href="/conversions/new" variant="primary">成果地点を追加</Button> : undefined}
      />
      {tab === 'points' && <ConversionsPageInner />}
      {tab === 'affiliates' && <AffiliatorsTab accountId={selectedAccountId} />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue />}
      {tab === 'report' && <ReportTab />}
      {tab === 'payment' && (selectedAccountId
        ? <AffiliatePaymentTab accountId={selectedAccountId} />
        : <p className="text-ink-secondary p-8 text-center text-sm">上のバーからLINEアカウントを選んでください。</p>)}
    </div>
  )
}

export default function ConversionsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ConversionsPageHost />
    </Suspense>
  )
}
