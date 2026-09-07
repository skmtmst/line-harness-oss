'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type ConversionDefinitionList,
  type ConversionDefinitionListItem,
  type ConversionDefinitionReport,
} from '@/lib/api'
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
import Dialog from '@/components/shared/dialog'

const DAY_MS = 24 * 60 * 60 * 1000

function definitionRange(days: number): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  const format = (value: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
  return { from: format(start), to: format(end) }
}

function rangeLabel(days: number): string {
  const { from, to } = definitionRange(days)
  const format = (value: string) => {
    const [, month, day] = value.split('-')
    return `${Number(month)}/${Number(day)}`
  }
  return `この${days}日（${format(from)}〜${format(to)}）`
}

function sourceTriggerLabel(point: Pick<ConversionDefinitionListItem, 'measureMethod' | 'sourceType' | 'targetUrl'>): string {
  if (point.measureMethod === 'url_reach') {
    return point.targetUrl ? `サイトの「${point.targetUrl}」に到達` : '指定したページに到達'
  }
  if (point.measureMethod === 'webhook') {
    if (point.sourceType === 'purchase' || point.sourceType === 'ec_order_confirmed') return 'EC連携の「注文が確定」'
    if (point.sourceType === 'ec_subscription_confirmed') return 'EC連携の「定期が確定」'
    if (point.sourceType === 'form_submit' || point.sourceType === 'form_submitted') return '回答フォームの送信'
    if (point.sourceType === 'visit' || point.sourceType === 'reservation_confirmed') return '予約管理の「予約が確定」'
    if (point.sourceType === 'webinar_completed') return 'ウェビナーの「視聴完了」'
    return '接続したシステムから成果の通知を受信'
  }
  return '管理画面から担当者が記録'
}

function usageLabel(point: ConversionDefinitionListItem): string {
  if (point.usageCount === 0) return 'どこからも使われていません'
  return `${point.usageCount.toLocaleString('ja-JP')}か所で使用中`
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

const PAGE_SIZE = 6

function ConversionsPageInner({ accountId }: { accountId: string | null }) {
  const [definitions, setDefinitions] = useState<ConversionDefinitionList | null>(null)
  const [summaryReport, setSummaryReport] = useState<ConversionDefinitionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PointSort>('cv-desc')
  const [status, setStatus] = useState<'all' | 'active' | 'stopped' | 'unused'>('all')
  const [page, setPage] = useState(1)
  const [loadFailed, setLoadFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
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
  const [stopTarget, setStopTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [detailTarget, setDetailTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    setDefinitions(null)
    setSummaryReport(null)
    const range = definitionRange(30)
    const [listResult, reportResult] = await Promise.allSettled([
      api.conversions.definitions({ ...range, lineAccountId: accountId ?? undefined, limit: 100 }),
      api.conversions.definitionReport({ ...range, lineAccountId: accountId ?? undefined }),
    ])
    if (listResult.status === 'fulfilled' && listResult.value.success
      && Array.isArray(listResult.value.data.items)) {
      setDefinitions(listResult.value.data)
    } else {
      setLoadFailed(true)
    }
    if (reportResult.status === 'fulfilled' && reportResult.value.success
      && Array.isArray(reportResult.value.data.byDefinition)) {
      setSummaryReport(reportResult.value.data)
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => { void load() }, [load])

  /**
   * 成果地点を消す。
   *
   * 処理中は受け付けない（二度押しで2回叩くと、2回目は404になって
   * 「消せませんでした」と出る。消えているのに失敗に見える）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。
   */
  const runStop = async () => {
    if (!stopTarget || stopping) return
    setStopping(true)
    setStopError('')
    try {
      // APIのDELETEは物理削除ではなく、計測停止として履歴を残す契約。
      const res = await api.conversions.deletePoint(stopTarget.id)
      if (!res.success) throw new Error(res.error)
      setStopTarget(null)
      await load()
    } catch {
      setStopError('この成果地点の計測を止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopping(false)
    }
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({
        ...definitionRange(30), lineAccountId: accountId ?? undefined,
      })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `conversion-definitions-${definitionRange(1).to}.csv`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch {
      setExportError('CSVを書き出せませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const points = useMemo(() => definitions?.items ?? [], [definitions])

  const kpi = useMemo(() => {
    return {
      currentCount: summaryReport?.kpis.netCount ?? points.reduce((sum, row) => sum + row.metrics.netCount, 0),
      previousCount: summaryReport?.kpis.previousNetCount ?? null,
      currentValue: summaryReport?.kpis.netValue ?? points.reduce((sum, row) => sum + row.metrics.netValue, 0),
      unusedCount: points.filter((row) => row.usageCount === 0).length,
    }
  }, [points, summaryReport])

  const shown = useMemo(() => {
    const q = query.trim()
    const searched = q ? points.filter((p) => p.name.includes(q)) : points
    const matched = searched.filter((point) => {
      if (status === 'all') return true
      if (status === 'unused') return point.usageCount === 0
      return point.status === status
    })
    return matched.toSorted((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'ja')
      if (sort === 'value-desc') return right.metrics.netValue - left.metrics.netValue
      return right.metrics.netCount - left.metrics.netCount
    })
  }, [points, query, sort, status])

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
          value={definitions?.pagination.total ?? null}
          unit="個"
          detail={definitions ? `動いているもの ${definitions.stateCounts.active}個` : '読み込み中'}
          loading={loading}
        />
        <KpiCard
          title="この30日の成果"
          value={summaryReport ? kpi.currentCount : null}
          unit="件"
          badge={summaryReport?.kpis.countChangeRate == null
            ? undefined
            : `${summaryReport.kpis.countChangeRate > 0 ? '+' : ''}${summaryReport.kpis.countChangeRate}%`}
          detail={kpi.previousCount === null
            ? '前の30日の比較は読み込めませんでした'
            : `前の30日 ${kpi.previousCount.toLocaleString()}件`}
          loading={loading}
        />
        <KpiCard
          title="金額がついた成果"
          value={summaryReport ? kpi.currentValue : null}
          unit="円"
          detail={`${points.filter((point) => point.value !== null).length}個の成果地点で金額を記録`}
          loading={loading}
        />
        <KpiCard
          title="1件も起きていない"
          value={definitions ? kpi.unusedCount : null}
          unit="個"
          badge={kpi.unusedCount > 0 ? '確認' : undefined}
          badgeTone={kpi.unusedCount > 0 ? 'neutral' : 'accent'}
          detail="決めたのに使われていません"
          loading={loading}
        />
      </div>

      <p className="bg-info-bg text-info mb-4 rounded-control px-4 py-3 text-sm font-semibold">
        成果地点は「数え方の決めごと」です。ここで決めたものを、案件・自動応答・分析などから呼び出して使います。
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button href="/conversions/new" variant="primary">＋ 成果地点をつくる</Button>
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? '書き出しています' : 'CSVで書き出す'}
        </Button>
      </div>
      {exportError ? <p className="text-danger mb-3 text-sm" role="alert">{exportError}</p> : null}

      <div
        data-design="Bar"
        className="mb-3 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
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
            className="min-w-64"
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ink-secondary text-sm tabular-nums">{rangeLabel(30)}</p>
            <Select
              aria-label="表示件数"
              value="6"
              size="page-size"
              options={[{ value: '6', label: '6件表示' }]}
              onChange={() => undefined}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['all', `すべて ${definitions?.pagination.total ?? 0}`],
            ['active', `動いている ${definitions?.stateCounts.active ?? 0}`],
            ['stopped', `止めている ${definitions?.stateCounts.stopped ?? 0}`],
            ['unused', `どこからも使われていない ${kpi.unusedCount}`],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              variant={status === value ? 'primary' : 'secondary'}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value)
                setPage(1)
              }}
            >
              {label}
            </Button>
          ))}
          <Select
            aria-label="並び順"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(value) => {
              setSort(value as PointSort)
              setPage(1)
            }}
          />
        </div>
      </div>

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
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {current.map((point) => (
                <tr key={point.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink w-1/5 px-4 py-3 text-sm font-medium">
                    {point.name}
                    <p className="text-ink-faint mt-0.5 text-xs">{EVENT_TYPE_LABELS[point.sourceType] ?? 'その他'}</p>
                  </td>
                  <td className="text-ink-secondary w-1/4 px-4 py-3 text-sm">
                    {sourceTriggerLabel(point)}
                    <p className="text-ink-faint mt-0.5 text-xs">
                      {measureLabel(point.measureMethod)}・{point.countRepeat === false ? '1人1回' : '毎回数える'}
                    </p>
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                    {point.metrics.netCount.toLocaleString('ja-JP')}件
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {point.value === null
                      ? '金額なし'
                      : `¥${point.metrics.netValue.toLocaleString('ja-JP')}`}
                  </td>
                  <td className={point.usageCount === 0
                    ? 'text-warning w-1/5 px-4 py-3 text-sm'
                    : 'text-ink-secondary w-1/5 px-4 py-3 text-sm'}>
                    {usageLabel(point)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setDetailTarget(point)}>中身を見る</Button>
                      <Button
                        href={`/analytics?conversionPointId=${encodeURIComponent(point.id)}`}
                        variant="primary"
                      >
                        使う場所を足す
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs">利用先の名前は詳細で確認できます。追加するときは分析画面でこの成果地点を選びます。</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-faint tabular-nums">
            成果地点 {definitions?.pagination.total ?? shown.length}個中 {shown.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}〜
            {Math.min(page * PAGE_SIZE, shown.length)}個を表示
          </span>
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      </div>

      <Dialog
        open={detailTarget !== null}
        title={detailTarget?.name ?? ''}
        description="この成果地点の数え方と利用状況です。"
        onCancel={() => setDetailTarget(null)}
        footer={detailTarget ? (
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDetailTarget(null)}>閉じる</Button>
            {detailTarget.status === 'active' ? (
              <Button onClick={() => {
                setDetailTarget(null)
                setStopError('')
                setStopTarget(detailTarget)
              }}>
                停止・削除
              </Button>
            ) : null}
          </div>
        ) : null}
      >
        {detailTarget ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-faint">何が起きたら数えるか</dt><dd className="text-ink mt-1 font-semibold">{sourceTriggerLabel(detailTarget)}</dd></div>
            <div><dt className="text-ink-faint">数え方</dt><dd className="text-ink mt-1 font-semibold">{detailTarget.countRepeat ? '毎回数える' : '1人1回'}</dd></div>
            <div><dt className="text-ink-faint">この30日</dt><dd className="text-ink mt-1 font-semibold">{detailTarget.metrics.netCount.toLocaleString('ja-JP')}件</dd></div>
            <div><dt className="text-ink-faint">利用先</dt><dd className="text-ink mt-1 font-semibold">{usageLabel(detailTarget)}</dd></div>
          </dl>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={stopTarget !== null}
        designNode="d8d3Mz"
        title={stopTarget ? `「${stopTarget.name}」を削除しますか？` : ''}
        description="使っている場所と、止めたあとに残る記録を確認してから操作を選びます。"
        confirmLabel="数えるのをやめる"
        busy={stopping}
        error={stopError}
        onConfirm={() => void runStop()}
        onCancel={() => {
          if (stopping) return
          setStopTarget(null)
          setStopError('')
        }}
      >
        {stopTarget && (
          <div className="space-y-4">
            <section className="border-danger bg-danger-bg rounded-control border p-4">
              <h3 className="text-danger text-sm font-bold">いま、この成果地点を使っている場所</h3>
              <div className="border-danger/20 mt-3 rounded-control border bg-canvas px-3 py-3">
                <p className="text-ink text-sm font-semibold">{usageLabel(stopTarget)}</p>
                <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                  利用先の件数は実データです。停止後も、過去の成果と利用先の記録は残ります。
                </p>
              </div>
            </section>

            <section className="bg-canvas-sunken rounded-control px-4 py-3">
              <p className="text-ink-secondary text-sm">
                これまでに数えた{' '}
                <strong className="text-ink tabular-nums">
                  {stopTarget.metrics.netCount.toLocaleString('ja-JP')}件
                </strong>
                の記録と金額は、そのまま残ります。
              </p>
            </section>

            <section>
              <h3 className="text-ink text-sm font-bold">どうしますか？</h3>
              <div className="mt-2 space-y-2">
                <div className="border-accent bg-accent-soft rounded-control flex items-start gap-3 border p-3">
                  <span className="border-accent bg-canvas mt-0.5 h-4 w-4 shrink-0 rounded-full border-4" aria-hidden />
                  <div>
                    <p className="text-ink text-sm font-semibold">数えるのをやめる（おすすめ）</p>
                    <p className="text-ink-faint mt-0.5 text-xs">これから先は数えません。過去の記録と分析は残します。</p>
                  </div>
                </div>
                <div className="border-hairline rounded-control flex items-start gap-3 border p-3 opacity-60">
                  <span className="border-hairline mt-0.5 h-4 w-4 shrink-0 rounded-full border" aria-hidden />
                  <div>
                    <p className="text-ink text-sm font-semibold">別の成果地点に差し替えてから削除する</p>
                    <p className="text-ink-faint mt-0.5 text-xs">利用先ごとの差し替え操作は、各利用先の画面で行います。</p>
                  </div>
                </div>
                <div className="border-hairline rounded-control flex items-start gap-3 border p-3 opacity-60">
                  <span className="border-hairline mt-0.5 h-4 w-4 shrink-0 rounded-full border" aria-hidden />
                  <div>
                    <p className="text-ink text-sm font-semibold">このまま削除する</p>
                    <p className="text-ink-faint mt-0.5 text-xs">過去の成果を守るため、物理削除は選べません。</p>
                  </div>
                </div>
              </div>
            </section>

            <p className="text-ink-faint text-xs">「数えるのをやめる」を選ぶと停止として記録され、過去の成果は削除されません。</p>
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
function ReportTab({ accountId }: { accountId: string | null }) {
  const [report, setReport] = useState<ConversionDefinitionReport | null>(null)
  const [periodDays, setPeriodDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setReport(null)
    void api.conversions.definitionReport({
      ...definitionRange(periodDays), lineAccountId: accountId ?? undefined,
    })
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data.byDefinition)
          && Array.isArray(response.data.daily) && Array.isArray(response.data.byRoute)) {
          setReport(response.data)
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, periodDays])

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({
        ...definitionRange(periodDays), lineAccountId: accountId ?? undefined,
      })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `conversion-report-${definitionRange(1).to}.csv`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch {
      setExportError('CSVを書き出せませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const daily = useMemo(() => {
    if (!report) return { names: [], days: [], max: 1 }
    const names = report.byDefinition.slice(0, 3).map((row) => row.conversionPointName)
    const byDay = new Map<string, Map<string, number>>()
    for (const row of report.daily) {
      const values = byDay.get(row.day) ?? new Map<string, number>()
      values.set(row.conversionPointName, (values.get(row.conversionPointName) ?? 0) + row.netCount)
      byDay.set(row.day, values)
    }
    const days = [...byDay].map(([day, values]) => {
      const first = values.get(names[0] ?? '') ?? 0
      const second = values.get(names[1] ?? '') ?? 0
      const third = values.get(names[2] ?? '') ?? 0
      const total = [...values.values()].reduce((sum, value) => sum + value, 0)
      return { day, first, second, third, other: Math.max(0, total - first - second - third), total }
    }).toSorted((left, right) => left.day.localeCompare(right.day))
    return { names, days, max: Math.max(1, ...days.map((row) => row.total)) }
  }, [report])

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

  if (!report) return null

  const fastest = report.kpis.fastestGrowing
  const fastestRate = fastest && fastest.previousNetCount > 0
    ? Math.round((fastest.countChange / fastest.previousNetCount) * 100)
    : fastest?.netCount ? 100 : 0
  const previousAverage = report.kpis.previousNetCount > 0
    ? Math.round(report.kpis.previousNetValue / report.kpis.previousNetCount)
    : null
  const topRoute = report.byRoute[0]

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
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? '書き出しています' : 'この画面をCSVで書き出す'}
        </Button>
      </div>
      {exportError ? <p className="text-danger text-sm" role="alert">{exportError}</p> : null}

      <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`この${periodDays}日の成果`}
          value={report.kpis.netCount}
          unit="件"
          badge={report.kpis.countChangeRate == null
            ? undefined
            : `${report.kpis.countChangeRate > 0 ? '+' : ''}${report.kpis.countChangeRate}%`}
          detail={`前の${periodDays}日 ${report.kpis.previousNetCount.toLocaleString('ja-JP')}件`}
        />
        <KpiCard
          title="金額"
          value={report.kpis.netValue}
          unit="円"
          detail={`前の${periodDays}日 ¥${report.kpis.previousNetValue.toLocaleString('ja-JP')}`}
        />
        <KpiCard
          title="1件あたり"
          value={report.kpis.averageNetValue === null ? null : Math.round(report.kpis.averageNetValue)}
          unit="円"
          detail={previousAverage === null ? `前の${periodDays}日は成果なし` : `前の${periodDays}日 ¥${previousAverage.toLocaleString('ja-JP')}`}
        />
        <KpiCard
          title="いちばん伸びた"
          value={fastest ? fastestRate : 0}
          unit="%"
          badge={fastest && fastestRate > 0 ? `+${fastestRate}%` : undefined}
          detail={fastest
            ? `${fastest.conversionPointName} ${fastest.netCount.toLocaleString('ja-JP')}件（前の${periodDays}日 ${fastest.previousNetCount.toLocaleString('ja-JP')}件）`
            : '比較できる成果はありません'}
        />
      </div>

      <p className="bg-info-bg text-info rounded-control px-4 py-3 text-sm font-semibold">
        成果地点ごとの件数と、どこから来たかです。数え方は「成果地点」で決めます。
      </p>

      <section className="bg-canvas rounded-card border-hairline border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold">日ごとの成果（この{periodDays}日）</h2>
            <p className="text-ink-faint mt-1 text-xs">棒の色は成果地点です。日ごとの実績を積み上げています。</p>
          </div>
          {daily && daily.names.length > 0 ? (
            <p className="text-ink-faint text-xs">{daily.names.join(' ／ ')} ／ そのほか</p>
          ) : null}
        </div>
        {daily && daily.days.length > 0 ? (
          <div className="mt-4 flex h-40 items-end gap-1" aria-label="日ごとの成果グラフ">
            {daily.days.map((day, index) => (
              <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                  style={{ height: `${Math.max(4, Math.round((day.total / daily.max) * 100))}%` }}
                  title={`${day.day} ${day.total}件`}
                >
                  {day.first > 0 ? <span className="bg-success" style={{ flexGrow: day.first }} /> : null}
                  {day.second > 0 ? <span className="bg-action" style={{ flexGrow: day.second }} /> : null}
                  {day.third > 0 ? <span className="bg-info" style={{ flexGrow: day.third }} /> : null}
                  {day.other > 0 ? <span className="bg-canvas-sunken" style={{ flexGrow: day.other }} /> : null}
                </div>
                {(index === 0 || index === daily.days.length - 1 || index % 5 === 0) ? (
                  <span className="text-ink-faint mt-1 truncate text-center text-xs">{day.day.slice(5).replace('-', '/')}</span>
                ) : <span className="mt-1 text-xs">&nbsp;</span>}
              </div>
            ))}
          </div>
        ) : <p className="text-ink-faint mt-4 text-sm">この期間には日ごとの成果がありません。</p>}
      </section>

      {report.byDefinition.length === 0 ? (
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
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {report.byDefinition.filter((row) => row.netCount > 0 || row.previousNetCount > 0).map((row) => {
                const changeRate = row.previousNetCount > 0
                  ? Math.round((row.countChange / row.previousNetCount) * 100)
                  : row.netCount > 0 ? 100 : 0
                return (
                  <tr key={row.conversionPointId} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm font-medium">
                      {row.conversionPointName}
                      <p className="text-ink-faint mt-0.5 text-xs">
                        {EVENT_TYPE_LABELS[row.sourceType] ?? 'その他'}
                      </p>
                    </td>
                    <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                      {row.netCount.toLocaleString('ja-JP')}件
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {row.previousNetCount.toLocaleString('ja-JP')}件
                    </td>
                    <td className={changeRate > 0
                      ? 'text-success px-4 py-3 text-right text-sm font-semibold tabular-nums'
                      : 'text-ink-secondary px-4 py-3 text-right text-sm tabular-nums'}>
                      {changeRate > 0 ? '+' : changeRate === 0 ? '±' : ''}{changeRate}%
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {topRoute ? `全体では ${topRoute.label}` : '経路の記録はありません'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button href={`/conversions?tab=points&point=${encodeURIComponent(row.conversionPointId)}`}>中身を見る</Button>
                    </td>
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
      />
      {tab === 'points' && <ConversionsPageInner accountId={selectedAccountId} />}
      {tab === 'affiliates' && <AffiliatorsTab accountId={selectedAccountId} />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue />}
      {tab === 'report' && <ReportTab accountId={selectedAccountId} />}
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
