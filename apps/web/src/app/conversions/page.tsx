'use client'

import { useState, useEffect, useMemo } from 'react'
import { api, type ConversionApprovalItem } from '@/lib/api'
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
}

/** 過去28日ぶんに絞る。設計のKPIはどれも「過去28日」で数えている。 */
function within28Days(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() <= 28 * 24 * 3600_000
}
import { Suspense } from 'react'
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
  { key: 'points', label: '成果地点（CV）' },
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
  const [reportAvailable, setReportAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<ConversionApprovalItem[]>([])
  const [approved, setApproved] = useState<ConversionApprovalItem[]>([])
  const [openOffers, setOpenOffers] = useState(0)
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
    setReportAvailable(false)
    setPending([])
    setApproved([])
    setOpenOffers(0)
    try {
      // 上のKPIは成果地点だけでは出ない。承認の待ち・確定と、公開中の案件を
      // 一緒に引く。1つ落ちても他は出せるよう allSettled。
      const [pointsRes, reportRes, pendingRes, approvedRes, offersRes] = await Promise.allSettled([
        api.conversions.points(),
        api.conversions.report(),
        api.conversionApprovals.list({ status: 'pending', limit: 200 }),
        api.conversionApprovals.list({ status: 'approved', limit: 200 }),
        api.affiliateOffers.list({ activeOnly: true }),
      ])
      if (pointsRes.status === 'fulfilled' && pointsRes.value.success && Array.isArray(pointsRes.value.data)) {
        setPoints(pointsRes.value.data)
      }
      else setLoadFailed(true)
      if (reportRes.status === 'fulfilled' && reportRes.value.success && Array.isArray(reportRes.value.data)) {
        setReport(reportRes.value.data)
        setReportAvailable(true)
      }
      if (pendingRes.status === 'fulfilled' && pendingRes.value.success && Array.isArray(pendingRes.value.data)) {
        setPending(pendingRes.value.data)
      }
      if (approvedRes.status === 'fulfilled' && approvedRes.value.success && Array.isArray(approvedRes.value.data)) {
        setApproved(approvedRes.value.data)
      }
      if (offersRes.status === 'fulfilled' && offersRes.value.success && Array.isArray(offersRes.value.data)) {
        setOpenOffers(offersRes.value.data.length)
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
    const approvedRecent = approved.filter((a) => within28Days(a.createdAt))
    return {
      confirmed: approvedRecent.length,
      confirmedYen: approvedRecent.reduce((s, a) => s + (a.value ?? 0), 0),
      pendingCount: pending.length,
      pendingYen: pending.reduce((s, a) => s + (a.value ?? 0), 0),
    }
  }, [approved, pending])

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
          title="確定した成果"
          value={kpi.confirmed}
          unit="件"
          detail="過去28日"
          loading={loading}
        />
        <KpiCard
          title="承認待ち"
          value={kpi.pendingCount}
          unit="件"
          detail={`合計 ¥${kpi.pendingYen.toLocaleString()}`}
          action={{ label: '成果承認', href: '/conversions?tab=approvals' }}
          loading={loading}
        />
        {/* 設計は「確定報酬」。報酬そのものを持つ列が無いので、確定した成果の
            金額を出している。案件の料率で計算した額とは一致しない。 */}
        <KpiCard
          title="確定報酬"
          value={kpi.confirmedYen}
          unit="円"
          detail="過去28日・成果の金額"
          loading={loading}
        />
        <KpiCard
          title="公開中の案件"
          value={openOffers}
          unit="件"
          detail="紹介できる案件"
          action={{ label: '案件', href: '/conversions?tab=offers' }}
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
          placeholder="CV名で検索"
          aria-label="CV名で検索"
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
          **期間と書き出しは押せる形にしない。**
          成果地点の一覧も `/api/conversions/report` も期間を受け取らないので、
          「今月」に絞った数は作れない。書き出しの口（CSV）も無い。
          押せない札を置くより、無いことを言葉で出す。
        */}
        <p className="text-ink-faint text-caption">
          <span className="text-ink-secondary font-medium">期間</span>{' '}
          <span className="tabular-nums">—</span>{' '}
          まだ繋がっていません。期間で絞る仕組みが接続されると表示されます。
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
        <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[880px]">
            <thead>
              <TableHeadRow>
                <Th>成果地点（CV）名</Th>
                <Th>種別</Th>
                <Th>計測方法</Th>
                <Th align="right">成果単価</Th>
                <Th align="right">CV数</Th>
                <Th>報酬</Th>
                <Th>状態</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {current.map((point) => (
                <tr key={point.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">
                    {point.name}
                    {point.targetUrl && (
                      <p className="text-ink-faint mt-0.5 max-w-[22rem] truncate text-[11px]" title={point.targetUrl}>
                        {point.targetUrl}
                      </p>
                    )}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    {EVENT_TYPE_LABELS[point.eventType] ?? point.eventType}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                        {measureLabel(point.measureMethod)}
                      </span>
                      {point.countRepeat === false && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                          一人一回
                        </span>
                      )}
                      {point.attributionDays != null && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap tabular-nums">
                          {point.attributionDays}日
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {point.value !== null ? `¥${point.value.toLocaleString()}` : '—'}
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                    {reportAvailable ? (countByPoint.get(point.id) ?? 0) : '—'}
                  </td>
                  {/* 報酬は案件ごとの料率で決まる。成果地点と案件を結ぶ列が無いので出せない。 */}
                  <td className="text-ink-faint px-4 py-3 text-sm">—</td>
                  {/* 計測を止める仕組みが無い。作った成果地点は常に計測中。 */}
                  <td className="px-4 py-3 text-sm">
                    <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-[11px]">計測中</span>
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
          成果が出たあとの承認は「成果承認」タブで行います。旧デザインではCV計測とアフィリエイトが別ページに分かれていて、定義と承認の間で画面を往復する必要がありました。
          <br />
          書き出しはまだ繋がっていません。CSVを作る口が接続されると、この場所に操作が出ます。
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-faint tabular-nums">全 {shown.length} 件</span>
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void api.conversions
      .report()
      .then((r) => {
        if (!cancelled && r.success) setRows(r.data)
      })
      .catch(() => {
        // レポートが引けなくても、他のタブは使える。
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const total = rows.reduce((s, r) => s + r.totalValue, 0)

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        まだ成果の記録がありません。成果地点を作って計測が始まると、ここに出ます。
      </div>
    )
  }

  return (
    <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
      <table className="w-full min-w-[560px]">
        <thead>
          <TableHeadRow>
            <Th>成果地点（CV）名</Th>
            <Th>種別</Th>
            <Th align="right">CV数</Th>
            <Th align="right">金額</Th>
          </TableHeadRow>
        </thead>
        <tbody className="divide-hairline divide-y">
          {rows.map((r) => (
            <tr key={r.conversionPointId} className="hover:bg-canvas-sunken">
              <td className="text-ink px-4 py-3 text-sm font-medium">{r.conversionPointName}</td>
              <td className="text-ink-secondary px-4 py-3 text-sm">
                {EVENT_TYPE_LABELS[r.eventType] ?? r.eventType}
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">{r.totalCount}</td>
              <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                {r.totalValue > 0 ? `¥${r.totalValue.toLocaleString()}` : '—'}
              </td>
            </tr>
          ))}
          <tr className="bg-canvas-sunken">
            <td className="text-ink-secondary px-4 py-3 text-sm font-medium" colSpan={3}>
              合計
            </td>
            <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
              ¥{total.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
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
      {tab === 'affiliates' && <AffiliatorsTab />}
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
