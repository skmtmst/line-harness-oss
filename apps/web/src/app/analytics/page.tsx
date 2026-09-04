'use client'

import SelectField from '@/components/shared/select-field'
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FriendField } from '@line-crm/shared'
import {
  api,
  type AnalyticsFriendsOverview,
  type AnalyticsCrossAxis,
  type AnalyticsCrossResult,
  type AnalyticsFunnelRunResult,
  type AnalyticsMetric,
  type AnalyticsReactionsOverview,
  type AnalyticsRoutesOverview,
  type AnalyticsUsageOverview,
  type AnalyticsUrlClicksOverview,
  type SavedAnalyticsSnapshot,
  type SavedAnalyticsSummary,
} from '@/lib/api'
import KpiCard from '@/components/dashboard/kpi-card'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import Chip, { type ChipTone } from '@/components/shared/chip'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { formatAnalyticsDateTime } from './analytics-time'
import { canTidyUsage, summarizeMenuFeatures, usageObservation } from './analytics-usage'

const TABS = [
  { key: 'friends', label: '友だちの増減' },
  { key: 'reactions', label: '配信の反応' },
  { key: 'routes', label: '経路と成果' },
  { key: 'usage', label: '使われ方' },
  { key: 'cross', label: 'クロス分析' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'url-clicks', label: 'URLクリック' },
  { key: 'saved', label: '保存した分析' },
]

/** 期間の選択肢。日数で持つ。 */
const RANGES = [
  { days: 7, label: '7日' },
  { days: 28, label: '28日' },
  { days: 90, label: '90日' },
]

function rangeFor(days: number): { from: string; to: string } {
  const jstNow = new Date(Date.now() + 9 * 3600_000)
  return {
    from: new Date(jstNow.getTime() - days * 24 * 3600_000).toISOString().slice(0, 10),
    to: jstNow.toISOString().slice(0, 10),
  }
}

function RangePicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="mb-4 flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r.days}
          onClick={() => onChange(r.days)}
          className={`rounded-pill px-3 py-1 text-sm transition-colors ${
            days === r.days
              ? 'bg-accent-deep text-on-accent'
              : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function SaveAnalysisAction({
  accountId,
  sourceKind,
  sourceResultId,
  defaultName,
}: {
  accountId: string
  sourceKind: 'cross' | 'funnel'
  sourceResultId: string
  defaultName: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setOpen(false)
    setName(defaultName)
    setSaved(false)
    setError('')
  }, [accountId, defaultName, sourceResultId])

  const save = async () => {
    if (!name.trim() || !sourceResultId) return
    setSaving(true)
    setError('')
    try {
      const response = await api.analytics.saved.create(accountId, {
        name: name.trim(),
        sourceKind,
        sourceResultId,
      })
      if (!response.success) throw new Error(response.error)
      setSaved(true)
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分析結果を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="bg-success-bg rounded-control flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="text-success">定義とこの時点の結果を保存しました</span>
        <Link href="/analytics?tab=saved" className="text-accent font-medium hover:underline">
          保存した分析を見る
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`saved-analysis-${sourceKind}`} className="sr-only">保存する分析名</label>
          <input
            id={`saved-analysis-${sourceKind}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            className="border-hairline rounded-control min-w-64 flex-1 border px-3 py-2 text-sm"
            placeholder="保存する分析名"
          />
          <Button onClick={() => void save()} disabled={saving || !name.trim()} variant="primary">
            {saving ? '保存中' : 'この名前で保存'}
          </Button>
          <Button onClick={() => setOpen(false)} disabled={saving} variant="secondary">
            やめる
          </Button>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} variant="secondary">
          この分析結果を保存
        </Button>
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
      <p className="text-ink-faint text-xs">条件の定義と、いま表示している結果を別々に固定して残します。</p>
    </div>
  )
}

/**
 * 棒グラフ。
 *
 * ライブラリを入れず、divの高さで描く。目盛りが要るほど細かく見るなら
 * 数字の表を見た方が速い、という判断。書き出したページも軽く済む。
 */
function Bars({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-[1.5rem] flex-1 flex-col items-center gap-1">
          <div
            className="bg-accent w-full rounded-t"
            style={{ height: `${Math.round((item.value / max) * 100)}%` }}
            title={`${item.label}: ${item.value}`}
          />
          <span className="text-ink-faint text-[10px] whitespace-nowrap">
            {item.label.slice(5)}
          </span>
        </div>
      ))}
    </div>
  )
}

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土']

/** 「2026-08-12」→「水」。JST の日付文字列をそのまま曜日にする。 */
function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAY_JP[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function CrossTab({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const [fields, setFields] = useState<FriendField[]>([])
  const [fieldId, setFieldId] = useState('')
  const [rowKind, setRowKind] = useState<'tag' | 'route' | 'score_band' | 'conversion_point' | 'booking_status' | 'purchase_status'>('tag')
  const [crossResult, setCrossResult] = useState<AnalyticsCrossResult | null>(null)
  const [crossRunId, setCrossRunId] = useState('')
  const [crossResultId, setCrossResultId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [audience, setAudience] = useState<{ id: string; memberCount: number; expiresAt: string } | null>(null)
  const [picked, setPicked] = useState<{
    row: string
    col: string
    rowKey: string
    columnKey: string
    count: number
  } | null>(null)

  useEffect(() => {
    void api.friendFields.list(accountId).then((res) => {
      if (res.success) {
        setFields(res.data)
        if (res.data.length > 0) setFieldId(res.data[0].id)
      }
    })
  }, [accountId])

  useEffect(() => {
    setCrossResult(null)
    setCrossRunId('')
    setCrossResultId('')
    setPicked(null)
    setAudience(null)
    setError('')
  }, [accountId])

  useEffect(() => {
    if (!crossRunId) return
    let active = true
    const check = async () => {
      try {
        const response = await api.analytics.crossResult(accountId, crossRunId)
        if (!active) return
        if (!response.success) throw new Error(response.error)
        if (response.data.result) {
          setCrossResult(response.data.result)
          setCrossRunId('')
          setLoading(false)
        } else if (response.data.state === 'failed') {
          setError(response.data.errorCode || 'クロス分析に失敗しました')
          setCrossRunId('')
          setLoading(false)
        }
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'クロス分析を確認できませんでした')
        setCrossRunId('')
        setLoading(false)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 1500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [accountId, crossRunId])

  const runCross = async () => {
    if (!fieldId) return
    setLoading(true)
    setError('')
    setPicked(null)
    setAudience(null)
    setCrossResult(null)
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 3600_000)
    const rowAxis: AnalyticsCrossAxis = { kind: rowKind }
    try {
      const response = await api.analytics.runCross(accountId, {
        rowAxis,
        columnAxis: { kind: 'field_choice', fieldId },
        measure: { kind: 'unique_friends' },
        filters: [],
        periodFrom: from.toISOString(),
        periodTo: now.toISOString(),
      })
      if (!response.success) throw new Error(response.error)
      setCrossResultId(response.data.id)
      setCrossRunId(response.data.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'クロス分析を開始できませんでした')
      setLoading(false)
    }
  }

  const prepareCrossAudience = async () => {
    if (!picked || !crossResultId) return
    setError('')
    try {
      const response = await api.analytics.createResultAudience(accountId, crossResultId, {
        sourceKind: 'cross',
        rowKey: picked.rowKey,
        columnKey: picked.columnKey,
      })
      if (!response.success) throw new Error(response.error)
      setAudience(response.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '対象者を準備できませんでした')
    }
  }

  const cells = useMemo(() => (crossResult?.cells ?? []).map((cell) => ({
    row: cell.rowLabel,
    col: cell.columnLabel,
    rowKey: cell.rowKey,
    columnKey: cell.columnKey,
    count: cell.value,
  })), [crossResult])

  const rows = crossResult?.rowValues ?? []
  const cols = crossResult?.columnValues ?? []
  const lookup = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of cells) map.set(`${c.rowKey}\u0000${c.columnKey}`, c.count)
    return map
  }, [cells])

  const fieldName = fields.find((f) => f.id === fieldId)?.name ?? '友だち情報'
  const rowLabel = {
    tag: 'タグ',
    route: '流入経路',
    score_band: 'スコア帯',
    conversion_point: '成果地点',
    booking_status: '予約状態',
    purchase_status: '購入状態',
  }[rowKind]

  const summary = useMemo(() => {
    if (cells.length === 0) return null
    const top = cells.reduce((best, c) => (c.count > best.count ? c : best), cells[0])
    // 行×列のうち、1人もいない組み合わせ。表に穴が多いなら、その掛け合わせは
    // 見ても仕方がない、と分かる。
    const empty = rows.length * cols.length - cells.filter((c) => c.count > 0).length
    const max = top.count
    return { top, empty, max }
  }, [cells, rows.length, cols.length])

  // 合計は延べ人数。1人が複数のタグを持つと、その人は行ごとに数えられる。
  const rowTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(c.rowKey, (m.get(c.rowKey) ?? 0) + c.count)
    return m
  }, [cells])
  const colTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(c.columnKey, (m.get(c.columnKey) ?? 0) + c.count)
    return m
  }, [cells])
  const grandTotal = useMemo(() => cells.reduce((sum, c) => sum + c.count, 0), [cells])

  /**
   * 表から機械的に読めることだけを出す。
   *
   * 設計は「犬向けの食事案内が要りそうです」のような提案まで書いているが、
   * それは商品や運用を知らないと書けない。ここで作り話をすると、根拠の無い
   * 提案が数字と同じ重みで並ぶ。割合の事実だけに留める。
   */
  const readings = useMemo(() => {
    if (!summary || cells.length === 0) return []
    const out: string[] = []
    const topRowTotal = rowTotals.get(summary.top.rowKey) ?? 0
    if (topRowTotal > 0) {
      const pct = Math.round((summary.top.count / topRowTotal) * 100)
      out.push(`「${summary.top.row}」の ${pct}% が「${summary.top.col}」です`)
      // 同じ列で、ほかの行の割合と比べる。差があるほど、その掛け合わせに
      // 意味がある可能性が高い。
      const others = rows
        .filter((r) => r.key !== summary.top.rowKey)
        .map((r) => {
          const total = rowTotals.get(r.key) ?? 0
          const n = lookup.get(`${r.key}\u0000${summary.top.columnKey}`) ?? 0
          return { row: r.label, pct: total > 0 ? (n / total) * 100 : 0 }
        })
        .sort((a, b) => b.pct - a.pct)
      if (others.length > 0 && others[0].pct > 0) {
        out.push(
          `同じ「${summary.top.col}」でも、「${others[0].row}」は ${Math.round(others[0].pct)}% です`,
        )
      }
    }
    if (summary.empty > 0) {
      out.push(`${summary.empty}個のマスに該当者がいません。掛け合わせが細かすぎるかもしれません`)
    }
    return out
  }, [summary, cells.length, rowTotals, rows, lookup])

  if (fields.length === 0) {
    return (
      <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
        友だち情報欄の項目がまだありません。
        <Link href="/tags/fields/new" className="text-accent ml-1 hover:underline">
          項目を追加
        </Link>
      </p>
    )
  }

  return (
    <div data-design-node="f5HsX">
      <p className="text-ink-faint mb-4 text-xs leading-relaxed">
        タグや友だち情報を掛け合わせて、友だちが何人いるかを表にします。数字を押すとその人たちを抽出でき、そのまま配信できます。
      </p>

      <section className="bg-canvas rounded-card border-hairline mb-4 border p-4">
        <h3 className="text-ink mb-3 text-sm font-semibold">何を掛け合わせるか</h3>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="text-ink-secondary mb-1 block text-xs font-medium">たての軸</label>
            <SelectField value={rowKind} onChange={(event) => setRowKind(event.target.value as typeof rowKind)} options={[{ value: "tag", label: "タグ" }, { value: "route", label: "流入経路" }, { value: "score_band", label: "スコア帯" }, { value: "conversion_point", label: "成果地点" }, { value: "booking_status", label: "予約状態" }, { value: "purchase_status", label: "購入状態" }]} className="v6-select w-full" />
          </div>
          <div>
            <label htmlFor="cross-field" className="text-ink-secondary mb-1 block text-xs font-medium">
              よこの軸
            </label>
            <SelectField
              id="cross-field"
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
              aria-label="よこの軸"
              className="v6-select w-full"
              options={fields.map((field) => ({
                value: field.id,
                label: `友だち情報 / ${field.name}`,
              }))}
            />
          </div>
          <Button onClick={() => void runCross()} disabled={loading || !fieldId} variant="primary">
            {loading ? '集計中' : 'この30日を集計'}
          </Button>
        </div>
        <p className="text-ink-faint mt-2 text-xs">
          集計結果はその時点のデータで固定します。期間や軸を変えた場合は、新しい結果として集計します。
        </p>
        {error && <p className="text-danger mt-2 text-xs">{error}</p>}
        {crossResult?.stateReason && <p className="text-warning mt-2 text-xs">{crossResult.stateReason}</p>}
      </section>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* 表の合計は延べ人数で、実際の人数とは違う。人数として出すと嘘になる。 */}
        <KpiCard title="集計対象" value={null} unit="人" detail="延べ数しか出せません" />
        <KpiCard
          title="いちばん多い組み合わせ"
          value={summary?.top.count ?? null}
          unit="人"
          detail={summary ? `${summary.top.row} × ${summary.top.col}` : '—'}
          loading={loading}
        />
        <KpiCard
          title="空のマス"
          value={summary?.empty ?? null}
          unit="個"
          detail="該当者なし"
          loading={loading}
        />
        {/* その項目に値が入っていない人は、集計のSQLが数えていない。 */}
        <KpiCard title="未入力" value={null} unit="人" detail={`${fieldName}が未記録`} />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          集計を受け付けました。終わるまでこの画面で確認しています。
        </div>
      ) : !crossResult ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          たて・よこの軸を選び、「この30日を集計」を押してください。
        </div>
      ) : cells.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          {crossResult.state === 'unavailable'
            ? crossResult.stateReason || 'この分析に必要なデータを取得できません。'
            : 'この条件に該当する人はいません。'}
        </div>
      ) : (
        <>
          <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="bg-canvas-sunken border-hairline border-b">
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">
                    {rowLabel} ＼ {fieldName}
                  </th>
                  {cols.map((col) => (
                    <th key={col.key} className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">
                      {col.label}
                    </th>
                  ))}
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">合計</th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {rows.map((row) => (
                  <tr key={row.key} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm font-medium">{row.label}</td>
                    {cols.map((col) => {
                      const n = lookup.get(`${row.key}\u0000${col.key}`) ?? 0
                      const active = picked?.rowKey === row.key && picked?.columnKey === col.key
                      // 濃さはその表の最大を基準にする。表ごとに数の桁が違うので、
                      // 絶対値で色を決めると、少ない表が全部薄くなる。
                      const strength = summary && summary.max > 0 ? n / summary.max : 0
                      return (
                        <td key={col.key} className="p-0 text-right">
                          <button
                            onClick={() => {
                              const source = cells.find((cell) => cell.rowKey === row.key && cell.columnKey === col.key)
                              setAudience(null)
                              setPicked(n > 0 && source ? {
                                row: row.label,
                                col: col.label,
                                rowKey: source.rowKey,
                                columnKey: source.columnKey,
                                count: n,
                              } : null)
                            }}
                            disabled={n === 0}
                            className={`w-full px-4 py-3 text-right text-sm tabular-nums transition-colors ${
                              n === 0 ? 'text-ink-faint' : 'text-ink-secondary hover:bg-accent-soft'
                            } ${active ? 'ring-accent ring-2 ring-inset' : ''}`}
                            style={
                              n > 0
                                ? { backgroundColor: `rgb(var(--accent-rgb, 37 99 235) / ${0.04 + strength * 0.18})` }
                                : undefined
                            }
                          >
                            {n === 0 ? '—' : n.toLocaleString('ja-JP')}
                          </button>
                        </td>
                      )
                    })}
                    <td className="text-ink px-4 py-3 text-right text-sm font-medium tabular-nums">
                      {(rowTotals.get(row.key) ?? 0).toLocaleString('ja-JP')}
                    </td>
                  </tr>
                ))}
                <tr className="bg-canvas-sunken">
                  <td className="text-ink-secondary px-4 py-3 text-sm font-medium">合計</td>
                  {cols.map((col) => (
                    <td key={col.key} className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {(colTotals.get(col.key) ?? 0).toLocaleString('ja-JP')}
                    </td>
                  ))}
                  <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                    {grandTotal.toLocaleString('ja-JP')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {canManage ? (
            <div className="bg-canvas rounded-card border-hairline mt-3 border p-4">
              <SaveAnalysisAction
                accountId={accountId}
                sourceKind="cross"
                sourceResultId={crossResultId}
                defaultName={`クロス分析 ${rowLabel} × ${fieldName}`}
              />
            </div>
          ) : (
            <p className="text-ink-faint mt-3 text-xs">結果の保存と個人一覧への移動は、統括・管理者だけが行えます。</p>
          )}

          <div className="bg-canvas rounded-card border-hairline mt-3 border p-4">
            {picked ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-ink text-sm">
                    「{picked.row} × {picked.col}」の {picked.count}人 を選択中
                  </p>
                  {canManage && <Button onClick={() => void prepareCrossAudience()} variant="secondary">友だち一覧で見る</Button>}
                </div>
                {audience && (
                  <div className="bg-success-bg rounded-control flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                    <span className="text-success">{audience.memberCount}人を24時間の対象者として準備しました</span>
                    <Link href={`/friends?audienceId=${encodeURIComponent(audience.id)}`} className="text-accent font-medium hover:underline">対象者を開く</Link>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-ink-faint text-xs">マスを押すと、その人たちを抽出できます</p>
            )}
          </div>

          {readings.length > 0 && (
            <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-ink text-sm font-semibold">この表から読めること</h3>
                {crossResult && <span className="text-ink-faint shrink-0 text-xs">
                  データ締切 {formatAnalyticsDateTime(crossResult.dataCutoffAt)}
                </span>}
              </div>
              <ul className="text-ink-secondary mt-2 space-y-1.5 text-xs leading-relaxed">
                {readings.map((r) => (
                  <li key={r}>・{r}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
            <h3 className="text-ink text-sm font-semibold">見かたの注意</h3>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>
                ・1人が複数のタグを持つ場合、それぞれの行に数えられます。合計が友だち数と一致しないことがあります
              </li>
              <li>・「未記録」は、その項目にまだ値が入っていない人です。いまは表に出ません</li>
              <li>・マスの色は、その表の中でいちばん多い数を基準にした濃さです</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function FunnelTab({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const [funnels, setFunnels] = useState<
    Array<{
      id: string
      name: string
      windowDays: number
      createdAt: string
      currentVersion: { id: string; versionNumber: number; createdAt: string } | null
      migrationState: 'ready' | 'needs_migration'
    }>
  >([])
  const [selected, setSelected] = useState('')
  const [run, setRun] = useState<AnalyticsFunnelRunResult | null>(null)
  const [groupKey, setGroupKey] = useState('all')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [funnelAudience, setFunnelAudience] = useState<{ id: string; memberCount: number; expiresAt: string } | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFunnels([])
    setSelected('')
    setRun(null)
    setGroupKey('all')
    setPicked(null)
    setFunnelAudience(null)
    void api.analytics.v6Funnels
      .list(accountId)
      .then((res) => {
        if (active && res.success) {
          setFunnels(res.data)
          if (res.data.length > 0) setSelected(res.data[0].id)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId])

  useEffect(() => {
    if (!selected) return
    let active = true
    setPicked(null)
    setFunnelAudience(null)
    setRun(null)
    setRunError('')
    void api.analytics.v6Funnels.latestRun(accountId, selected).then((res) => {
      if (!active) return
      if (res.success) {
        setRun(res.data)
        setGroupKey(res.data.groups[0]?.key ?? 'all')
      }
      else if (res.error !== 'Not found') setRunError(res.error)
    })
    return () => {
      active = false
    }
  }, [accountId, selected])

  const runNow = async () => {
    if (!selected) return
    setRunning(true)
    setRunError('')
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 3600_000)
    try {
      const response = await api.analytics.v6Funnels.run(accountId, selected, {
        cohortFrom: from.toISOString(),
        cohortTo: now.toISOString(),
      })
      if (!response.success) throw new Error(response.error)
      setRun(response.data)
      setGroupKey(response.data.groups[0]?.key ?? 'all')
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '再集計できませんでした')
    } finally {
      setRunning(false)
    }
  }

  const activeGroup = run?.groups.find((group) => group.key === groupKey) ?? run?.groups[0] ?? null
  const result = activeGroup?.steps ?? null

  const comparisonGap = useMemo(() => {
    if (!run || run.groups.length < 2) return null
    let largest = 0
    for (let index = 0; index < run.groups[0].steps.length; index += 1) {
      const rates = run.groups
        .map((group) => group.steps[index]?.conversionFromPrevious)
        .filter((value): value is number => value !== null && value !== undefined)
      if (rates.length < 2) continue
      largest = Math.max(largest, Math.max(...rates) - Math.min(...rates))
    }
    return Math.round(largest * 1000) / 10
  }, [run])

  const prepareFunnelAudience = async () => {
    if (!run?.runId || picked === null || !result?.[picked - 1] || !activeGroup) return
    setRunError('')
    try {
      const response = await api.analytics.createResultAudience(accountId, run.runId, {
        sourceKind: 'funnel',
        groupKey: activeGroup.key,
        stepOrder: result[picked - 1].stepOrder,
        selection: 'stopped',
      })
      if (!response.success) throw new Error(response.error)
      setFunnelAudience(response.data)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '対象者を準備できませんでした')
    }
  }

  // いちばん落ちる段。人数の差ではなく、落ちた割合で選ぶ。母数の大きい段が
  // いつも1位になってしまうため。
  const worst = useMemo(() => {
    if (!result || result.length < 2) return null
    let found: { index: number; lost: number; rate: number } | null = null
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1].reached
      if (prev === 0) continue
      const lost = prev - result[i].reached
      const rate = lost / prev
      if (!found || rate > found.rate) found = { index: i, lost, rate }
    }
    return found
  }, [result])

  const overall = useMemo(() => {
    if (!result || result.length === 0) return null
    const first = result[0]
    const last = result[result.length - 1]
    return {
      entry: first.reached,
      entryLabel: first.label,
      last: last.reached,
      rate: first.reached > 0 ? Math.round((last.reached / first.reached) * 1000) / 10 : null,
    }
  }, [result])

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  const top = result?.[0]?.reached ?? 0
  const selectedFunnel = funnels.find((f) => f.id === selected) ?? null

  return (
    <div data-design-node="C2I7ry">
      <p className="text-ink-faint mb-4 text-xs leading-relaxed">
        友だちがどこまで進んで、どこで離れたかを段階ごとに見ます。段を自由に組み替えられるので、配信の流れでも購入の流れでも作れます。
      </p>

      {creating ? (
        <FunnelForm
          accountId={accountId}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void api.analytics.v6Funnels.list(accountId).then((res) => {
              if (res.success) setFunnels(res.data)
            })
            setSelected(id)
          }}
        />
      ) : funnels.length === 0 ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          ファネルがまだありません。段を2つ以上つないで、どこで離れているかを見られます。
          {canManage ? (
            <button
              onClick={() => setCreating(true)}
              className="text-accent ml-1 hover:underline"
            >
              ＋ 段を足す
            </button>
          ) : (
            <span className="ml-1">作成は統括・管理者へ依頼してください。</span>
          )}
        </p>
      ) : (
        <>
          <section className="bg-canvas rounded-card border-hairline mb-4 border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-ink text-sm font-semibold">段の並び</h3>
                <p className="text-ink-faint mt-0.5 text-xs">
                  上から順に通った人だけを数えます。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void runNow()} disabled={running} variant="secondary">
                  {running ? '再集計中' : 'この30日を再集計'}
                </Button>
                {canManage && (
                  <button
                    onClick={() => setCreating(true)}
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs font-medium"
                  >
                    ＋ 段を足す
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="funnel-select" className="text-ink-secondary mb-1 block text-xs font-medium">
                ファネル
              </label>
              <SelectField
                id="funnel-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                aria-label="ファネル"
                className="border-hairline rounded-control w-full border px-3 py-2 text-sm sm:w-72"
                options={funnels.map((funnel) => ({ value: funnel.id, label: funnel.name }))}
              />
              {selectedFunnel && (
                <p className="text-ink-faint mt-1 text-xs">
                  {selectedFunnel.windowDays}日以内に通った人を数えます。
                  {selectedFunnel.currentVersion
                    ? ` 定義版 ${selectedFunnel.currentVersion.versionNumber}`
                    : ' 現行定義の移行が必要です'}
                </p>
              )}
            </div>

            {result && result.length > 0 && (
              <ol className="mt-3 flex flex-wrap gap-1.5">
                {result.map((step) => (
                  <li
                    key={step.stepOrder}
                    className="border-hairline text-ink-secondary rounded-pill border px-3 py-1 text-xs"
                  >
                    {step.label}
                  </li>
                ))}
              </ol>
            )}

            {/* 条件ごとに通過率を並べる仕組みが無い。ファネルの定義が1本の
                段の列だけで、条件で分ける口を持っていない。 */}
            {run && <p className="text-ink-faint mt-2 text-xs">
              集計期間 {new Date(run.cohortFrom).toLocaleDateString('ja-JP')}〜{new Date(run.cohortTo).toLocaleDateString('ja-JP')}
              ／データ締切 {formatAnalyticsDateTime(run.dataCutoffAt)}
            </p>}
            {runError && <p className="text-danger mt-2 text-xs">{runError}</p>}
            {run?.stateReason && <p className="text-warning mt-2 text-xs">{run.stateReason}</p>}
            {run && run.groups.length > 1 && (
              <div className="mt-3 max-w-xs">
                <label htmlFor="funnel-group" className="text-ink-secondary mb-1 block text-xs font-medium">比較する条件</label>
                <SelectField
                  id="funnel-group"
                  value={groupKey}
                  onChange={(event) => setGroupKey(event.target.value)}
                  aria-label="比較する条件"
                  className="v6-select w-full"
                  options={run.groups.map((group) => ({
                    value: group.key,
                    label: `${group.label}（入口 ${group.entrants}人）`,
                  }))}
                />
              </div>
            )}
          </section>

          <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              title="入口"
              value={overall?.entry ?? null}
              unit="人"
              detail={overall?.entryLabel ?? '—'}
            />
            <KpiCard
              title="最後まで"
              value={overall?.last ?? null}
              unit="人"
              detail={overall?.rate != null ? `通過率 ${overall.rate}%` : '—'}
            />
            <KpiCard
              title="いちばん落ちる段"
              value={worst ? Math.round(worst.rate * 100) : null}
              unit="%"
              detail={
                worst && result
                  ? `${result[worst.index - 1].label} → ${result[worst.index].label}`
                  : '—'
              }
            />
            {/* 段ごとの到達日時を持っていない。ファネルの集計は「通ったか」
                だけを見ていて、いつ通ったかを残していない。 */}
            <KpiCard title="平均の到達日数" value={null} unit="日" detail="入口から最後まで" />
            <KpiCard
              title="比較で差が大きい段"
              value={comparisonGap}
              unit="pt"
              detail={run && run.groups.length > 1 ? `${run.groups.length}条件を比較` : '比較条件なし'}
            />
          </div>

          {result && (
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <h3 className="text-ink text-sm font-semibold">全体の流れ</h3>
              <p className="text-ink-faint mt-0.5 mb-3 text-xs">
                かっこ内はひとつ前の段からの通過率
              </p>
              <div className="space-y-3">
                {result.map((step, i) => {
                  const prev = i > 0 ? result[i - 1].reached : null
                  const lost = prev != null ? prev - step.reached : 0
                  const isWorst = worst?.index === i
                  return (
                    <div key={step.stepOrder}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <p className="text-ink text-sm font-medium">
                          {i + 1}. {step.label}
                        </p>
                        <p className="text-ink-secondary text-sm tabular-nums">
                          {step.reached.toLocaleString('ja-JP')} 人
                          {i > 0 && (
                            <span className="text-ink-faint ml-2 text-xs">
                              （{step.conversionFromPrevious == null ? '—' : `${Math.round(step.conversionFromPrevious * 1000) / 10}%`}）
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setFunnelAudience(null)
                          setPicked(lost > 0 ? i : null)
                        }}
                        disabled={lost <= 0}
                        className="bg-canvas-sunken block h-6 w-full overflow-hidden rounded text-left"
                        aria-label={`${step.label}の段`}
                      >
                        <span
                          className={`block h-full ${isWorst ? 'bg-warning' : 'bg-accent'}`}
                          style={{ width: top > 0 ? `${(step.reached / top) * 100}%` : '0%' }}
                        />
                      </button>
                      {/* 落ちた人数と割合は数えられる。「案内が届いていない
                          可能性があります」のような原因は、運用を知らないと
                          書けないので出さない。 */}
                      {prev != null && lost > 0 && (
                        <p className={`mt-1 text-xs ${isWorst ? 'text-warning' : 'text-ink-faint'}`}>
                          {lost.toLocaleString('ja-JP')}人（
                          {Math.round((lost / prev) * 1000) / 10}%）がここで止まっています。
                          {isWorst && ' この分析でいちばん落ちる段です。'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="border-hairline mt-4 border-t pt-3">
                {picked != null && result[picked] ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-ink text-sm">
                      「{result[picked - 1]?.label}まで進んで{result[picked].label}に至っていない{' '}
                      {(result[picked - 1].reached - result[picked].reached).toLocaleString('ja-JP')}人」を選択中
                    </p>
                    {canManage && <Button onClick={() => void prepareFunnelAudience()} variant="secondary">友だち一覧で見る</Button>}
                  </div>
                ) : (
                  <p className="text-ink-faint text-xs">
                    段を押すと、そこで止まっている人を選べます。
                  </p>
                )}
                {funnelAudience && (
                  <div className="bg-success-bg mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control p-3 text-xs">
                    <span className="text-success">{funnelAudience.memberCount}人を24時間の対象者として準備しました</span>
                    <Link href={`/friends?audienceId=${encodeURIComponent(funnelAudience.id)}`} className="text-accent font-medium hover:underline">対象者を開く</Link>
                  </div>
                )}
              </div>
            </section>
          )}

          {run?.runId && canManage && (
            <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
              <SaveAnalysisAction
                accountId={accountId}
                sourceKind="funnel"
                sourceResultId={run.runId}
                defaultName={selectedFunnel?.name ?? 'ファネル分析'}
              />
            </section>
          )}

          <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
            <h3 className="text-ink text-sm font-semibold">段の作り方</h3>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>・段には タグ・友だち情報・フォーム回答・サイトの行動・購入 を置けます</li>
              <li>・順番どおりに通った人だけを数えます。飛ばした人は含みません</li>
              <li>・比較条件を定義版に含めると、最大3群の通過率を同じ結果で比べられます</li>
              <li>・再集計すると新しい結果を作り、前の結果は書き換えません</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

/**
 * ファネルの作成。
 *
 * 段は上から順に「次に進んだ人」を数える。作るときも上から並べる順で
 * 入れてもらう。番号を振らせると、抜けや重複を毎回確かめることになる。
 */
function FunnelForm({
  accountId,
  onCancel,
  onCreated,
}: {
  accountId: string
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const KINDS = [
    { key: 'friend_add', label: '友だち追加', hint: '' },
    { key: 'tag', label: 'タグが付いた', hint: 'タグのID' },
    { key: 'field', label: '情報欄に値が入った', hint: '項目のID（値は問いません）' },
    { key: 'form', label: 'フォームに答えた', hint: 'フォームのID' },
    { key: 'site_event', label: 'サイトのページを見た', hint: 'パスのまとまり（例: thanks）' },
    { key: 'purchase', label: '購入が確定した', hint: '' },
    { key: 'link_click', label: 'リンクを踏んだ', hint: '計測リンクのID' },
    { key: 'conversion', label: '成果が記録された', hint: '成果地点のID' },
    { key: 'message', label: 'メッセージを受信した', hint: '' },
    { key: 'booking', label: '予約が確定した', hint: '' },
    { key: 'automation', label: 'オートメーションが動いた', hint: 'オートメーションのID' },
  ]

  const [name, setName] = useState('')
  const [steps, setSteps] = useState([
    { label: '', kind: 'tag', value: '' },
    { label: '', kind: 'conversion', value: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matchFor = (kind: string, value: string): Record<string, string> => {
    if (kind === 'friend_add') return {}
    if (kind === 'tag') return { tagId: value }
    if (kind === 'field') return { fieldId: value }
    if (kind === 'form') return { formId: value }
    if (kind === 'site_event') return { eventType: 'page_view', pathGroup: value }
    if (kind === 'purchase') return { status: 'confirmed' }
    if (kind === 'link_click') return { trackedLinkId: value }
    if (kind === 'conversion') return { conversionPointId: value }
    if (kind === 'message') return { direction: 'received' }
    if (kind === 'booking') return { status: 'confirmed' }
    return { automationId: value }
  }

  const kindNeedsValue = (kind: string) => !['friend_add', 'purchase', 'message', 'booking'].includes(kind)

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (steps.some((s) => !s.label.trim())) {
      setError('すべての段に名前を付けてください')
      return
    }
    if (steps.some((s) => kindNeedsValue(s.kind) && !s.value.trim())) {
      setError('選んだ行動に必要なIDまたは値を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.analytics.v6Funnels.create(accountId, {
        name: name.trim(),
        windowDays: 30,
        steps: steps.map((s) => ({
          label: s.label.trim(),
          kind: s.kind,
          match: matchFor(s.kind, s.value.trim()),
        })),
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      onCreated(res.data.funnelId)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-canvas rounded-card border-hairline mb-5 space-y-4 border p-5">
      <div>
        <label htmlFor="fn-name" className="text-ink-secondary mb-1 block text-sm font-medium">
          名前
        </label>
        <input
          id="fn-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 友だち追加から購入まで"
          className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-3">
        <p className="text-ink-secondary text-sm font-medium">段（上から順に見ます）</p>
        {steps.map((step, i) => (
          <div key={i} className="border-hairline flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <span className="text-ink-faint pb-2 text-sm tabular-nums">{i + 1}.</span>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">段の名前</label>
              <input
                type="text"
                value={step.label}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, label: e.target.value } : s)),
                  )
                }
                placeholder="例: 友だち追加"
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-ink-faint mb-1 block text-xs">何をしたら</label>
              <SelectField
                value={step.kind}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, kind: e.target.value } : s)),
                  )
                }
                aria-label={`${i + 1}段目で何をしたら進むか`}
                className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                options={KINDS.map((kind) => ({ value: kind.key, label: kind.label }))}
              />
            </div>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">
                {KINDS.find((k) => k.key === step.kind)?.hint || '追加の指定はありません'}
              </label>
              <input
                type="text"
                value={step.value}
                disabled={!kindNeedsValue(step.kind)}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, value: e.target.value } : s)),
                  )
                }
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint"
              />
            </div>
            {steps.length > 2 && (
              <button
                onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                className="text-danger hover:bg-danger-bg rounded px-2 py-1.5 text-xs"
              >
                外す
              </button>
            )}
          </div>
        ))}
        {steps.length < 10 && (
          <button
            onClick={() => setSteps((prev) => [...prev, { label: '', kind: 'tag', value: '' }])}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-sm"
          >
            ＋ 段を足す
          </button>
        )}
      </div>

      <p className="text-ink-faint text-xs">
        段は2つ以上10個まで。1段だけだと「ただの件数」になり、どこで離れたかが分かりません。
      </p>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={saving}
          variant="primary"
        >
          {saving ? '保存中...' : '作成'}
        </Button>
        <Button
          onClick={onCancel}
        >
          キャンセル
        </Button>
      </div>
    </div>
  )
}

type OverviewResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

function useOverview<T>(load: () => Promise<OverviewResult<T>>, key: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    void load()
      .then((result) => {
        if (!active) return
        if (result.success) setData(result.data)
        else setError(result.error || '分析を表示できませんでした')
      })
      .catch(() => {
        if (active) setError('分析を表示できませんでした')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
    // loaderはkeyが表すアカウント・期間が変わった時だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { data, loading, error }
}

function metricText(
  value: AnalyticsMetric<number | string>,
  options?: { percent?: boolean; currency?: boolean },
) {
  if (value.value === null) return '—'
  if (typeof value.value === 'string') return value.value
  if (options?.percent) return `${Math.round(value.value * 1000) / 10}%`
  if (options?.currency) return `${value.value.toLocaleString('ja-JP')}円`
  return value.value.toLocaleString('ja-JP')
}

/**
 * 指標が自分で言っている状態を見てから数を出す。
 *
 * 契約では `AnalyticsMetric` が `value` と一緒に `state` と `reason` を持っている。
 * 初回集計を待っている（`pending`）ときや取得に失敗した（`failed`）とき、
 * サーバは `value` に 0 を入れて返すことがある。**それをそのまま描くと
 * 「日別集計の初回更新を待っています」と「0人」が同じカードに並び、
 * 読む人には0が実測に見える。**
 *
 * 実測できた（`available`）か、途中まで集計できた（`partial`）ときだけ数を出す。
 * それ以外は `—` にして、理由のほうを読ませる。
 */
function shownValue(metric: AnalyticsMetric<number>): number | null {
  if (metric.value === null) return null
  return metric.state === 'available' || metric.state === 'partial' ? metric.value : null
}

function MetricCell({ metric, percent, currency }: {
  metric: AnalyticsMetric<number | string>
  percent?: boolean
  currency?: boolean
}) {
  // 表の桁も帯と同じ決めごとで出す。`value === null` だけ見ていると、
  // 集計待ちの 0 が実測の 0 と同じ濃さで並ぶ。
  const shown = metric.state === 'available' || metric.state === 'partial'
  return <span className={metric.value === null || !shown ? 'text-ink-faint' : 'text-ink'} title={metric.reason ?? undefined}>
    {shown ? metricText(metric, { percent, currency }) : '—'}
  </span>
}

function DateTimeMetricCell({ metric }: { metric: AnalyticsMetric<string> }) {
  return <span className={metric.value === null ? 'text-ink-faint' : 'text-ink'} title={metric.reason ?? undefined}>
    {formatAnalyticsDateTime(metric.value)}
  </span>
}

function OverviewState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-10 text-center text-sm">分析を読み込んでいます</div>
  if (error) return <div className="bg-danger-bg rounded-card border-danger text-danger border p-6 text-sm">{error}</div>
  return null
}

function FriendsOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const state = useOverview<AnalyticsFriendsOverview>(
    () => api.analytics.friendsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:friends`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  const addedValue = shownValue(overview.metrics.added)
  const removedValue = shownValue(overview.metrics.removed)
  // 差し引きは増加と減少から導いた値。元の2つが出せないなら、差し引きも出せない。
  // ここを道連れにしないと「増えた —／減った —／差し引き 0人」という読めない並びになる。
  const netValue = addedValue === null || removedValue === null ? null : shownValue(overview.metrics.net)
  const pendingReason = overview.stateReason ?? '日ごとの集計がまだありません'
  // 日ごとの表は行ごとの状態を持たない。全体の状態が「実測できた」でないときは、
  // 0 が並んだ30行を出さずに理由を1行で出す。
  const daysShown = overview.state === 'available' || overview.state === 'partial'
  return <div data-design-node="Zxezb" className="space-y-4">
    {overview.state !== 'available' && overview.stateReason && <div className="bg-warning-bg border-warning rounded-card border px-4 py-3 text-sm">{overview.stateReason}</div>}
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="増えた友だち" value={addedValue} unit="人" detail={overview.metrics.added.reason ?? (addedValue === null ? pendingReason : `初回 ${metricText(overview.metrics.firstTime)}人`)} />
      <KpiCard title="減った友だち" value={removedValue} unit="人" detail={overview.metrics.removed.reason ?? (removedValue === null ? pendingReason : 'ブロック・解除')} />
      <KpiCard title="差し引き" value={netValue} unit="人" detail={overview.metrics.net.reason ?? (netValue === null ? pendingReason : '増加 − 減少')} />
      <KpiCard title="現在つながっている" value={shownValue(overview.metrics.currentFriends)} unit="人" detail={overview.metrics.currentFriends.reason ?? `再追加 ${metricText(overview.metrics.returning)}人`} />
    </div>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3"><h2 className="text-sm font-semibold">日ごとの増減</h2><span className="text-ink-faint text-xs">{state.data.period.from}〜{state.data.period.to}</span></div>
      <table className="w-full table-fixed">
        <thead><TableHeadRow><Th>日付</Th><Th align="right">増加</Th><Th align="right">減少</Th><Th align="right">差し引き</Th><Th>同日の施策</Th></TableHeadRow></thead>
        <tbody className="divide-hairline divide-y">{!daysShown ? <tr><td colSpan={5} className="text-ink-faint p-8 text-center text-sm">{pendingReason}</td></tr> : [...overview.days].reverse().map((day) => {
          const campaigns = overview.campaigns.filter((item) => item.date === day.date)
          const names = campaigns.map((item) => item.name).join('、')
          return <tr key={day.date} className="text-sm"><td className="px-4 py-2 tabular-nums">{day.date}</td><td className="px-4 py-2 text-right tabular-nums">{day.added}</td><td className="px-4 py-2 text-right tabular-nums">{day.removed}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{day.net > 0 ? '+' : ''}{day.net}</td><td className="text-ink-secondary truncate px-4 py-2" title={names || undefined}>{names || '—'}</td></tr>
        })}</tbody>
      </table>
    </div>
  </div>
}

function ReactionsOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const state = useOverview<AnalyticsReactionsOverview>(
    () => api.analytics.reactionsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:reactions`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  return <div data-design-node="J6Inc" className="space-y-4">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="送信対象" value={overview.metrics.sent.value} unit="人" detail={overview.metrics.sent.reason ?? '配信ごとの対象'} />
      <KpiCard title="到達" value={overview.metrics.delivered.value} unit="人" detail={overview.metrics.delivered.reason ?? 'LINE取得値'} />
      <KpiCard title="開封" value={overview.metrics.opened.value} unit="人" detail={overview.metrics.opened.reason ?? '20人未満は取得対象外'} />
      <KpiCard title="自社URLクリック" value={overview.metrics.trackedClicks.value} unit="回" detail={overview.clickDefinition} />
    </div>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>配信</Th><Th>種類・日時</Th><Th align="right">対象</Th><Th align="right">到達</Th><Th align="right">開封</Th><Th align="right">LINEクリック</Th><Th align="right">成果</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.campaigns.length === 0 ? <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">この期間の配信はありません</td></tr> : overview.campaigns.map((item) => <tr key={`${item.kind}:${item.id}`} className="text-sm"><td className="truncate px-4 py-3 font-medium" title={item.name}>{item.name}</td><td className="text-ink-secondary px-3 py-3">{item.kind === 'broadcast' ? '一斉配信' : 'シナリオ'}<br /><span className="text-xs tabular-nums">{item.sentAt.slice(0, 16).replace('T', ' ')}</span></td><td className="px-3 py-3 text-right"><MetricCell metric={item.targetPeople} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.delivered} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.opened} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.lineClicked} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.outcomes} /></td></tr>)}</tbody>
    </table></div>
  </div>
}

function RoutesOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const state = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:routes`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  return <div data-design-node="YBGtm" className="space-y-4">
    <div className="bg-info-bg border-info rounded-card flex items-center justify-between border px-4 py-3 text-sm"><span>帰属方式: {overview.attributionLabel}</span><Link href={overview.searchConsoleHref} className="text-accent font-medium hover:underline">Search Consoleを見る</Link></div>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>経路</Th><Th align="right">クリック</Th><Th align="right">友だち追加</Th><Th align="right">現在</Th><Th align="right">反応</Th><Th align="right">承認成果</Th><Th align="right">成果金額</Th><Th align="right">広告費</Th><Th align="right">差し引き</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.routes.length === 0 ? <tr><td colSpan={9} className="text-ink-faint p-8 text-center text-sm">この期間に集計できる経路はありません</td></tr> : overview.routes.map((item) => <tr key={item.id} className="text-sm"><td className="truncate px-3 py-3 font-medium" title={item.name}>{item.name}</td><td className="px-2 py-3 text-right"><MetricCell metric={item.clicks} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.friendAdds} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.currentFriends} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.reactionPeople} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.conversions.approved} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.conversions.revenue} currency /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.adCost} currency /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.profitAfterAdCost} currency /></td></tr>)}</tbody>
    </table></div>
  </div>
}

function UsageOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const [menuFeatures, setMenuFeatures] = useState<{ enabled: number; total: number } | null>(null)
  const [menuFeaturesError, setMenuFeaturesError] = useState('')
  const state = useOverview<AnalyticsUsageOverview>(
    () => api.analytics.usageOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:usage`,
  )
  useEffect(() => {
    let active = true
    setMenuFeatures(null)
    setMenuFeaturesError('')
    void api.featureSettings.get(accountId).then((response) => {
      if (!active) return
      if (!response.success) {
        setMenuFeaturesError('メニューに出している機能を確認できません')
        return
      }
      setMenuFeatures(summarizeMenuFeatures(response.data))
    }).catch(() => {
      if (active) setMenuFeaturesError('メニューに出している機能を確認できません')
    })
    return () => { active = false }
  }, [accountId])
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  return <div data-design-node="QQ1SR" className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title="使っている機能"
        value={menuFeatures?.enabled ?? null}
        unit={menuFeatures ? ` / ${menuFeatures.total}` : ''}
        detail={menuFeaturesError || 'メニューに出している機能のうち'}
      />
      <KpiCard
        title="作ったのに使っていない"
        value={overview.summary.unusedItems.value}
        unit="個"
        detail={overview.summary.unusedItems.reason ?? '8分類の利用状況から集計'}
        action={{ label: '片づける', href: '#usage-items' }}
      />
      <KpiCard
        title="自動で動いた回数"
        value={overview.summary.automaticRuns.value}
        unit="回"
        detail={`この30日。${overview.summary.automaticRuns.reason ?? '実行記録から集計'}。手で送ったのは${overview.summary.manualSends.value?.toLocaleString('ja-JP') ?? '—'}回`}
      />
      <KpiCard
        title="手作業が減った時間"
        value={overview.summary.estimatedHoursSaved.value}
        unit="時間"
        detail={overview.summary.estimatedHoursSaved.reason ?? '1件30秒として試算'}
      />
    </div>
    {overview.stateReason && <div className="bg-warning-bg border-warning rounded-card border px-4 py-3 text-sm">{overview.stateReason}</div>}
    <div id="usage-items" className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>機能</Th><Th align="right">作成</Th><Th align="right">利用中</Th><Th align="right">未使用</Th><Th>気づいたこと</Th><Th align="right">操作</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.categories.map((item) => {
        const observation = usageObservation(item)
        return <tr key={item.key} className="text-sm"><td className="px-4 py-3"><p className="font-medium">{item.label}</p><p className="text-ink-faint mt-1 truncate text-xs">最終利用 <DateTimeMetricCell metric={item.lastUsedAt} /></p></td><td className="px-3 py-3 text-right"><MetricCell metric={item.created} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.inUse} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.unused} /></td><td className="px-3 py-3"><p className={`truncate ${observation.tone === 'warning' ? 'text-warning' : observation.tone === 'unknown' ? 'text-ink-faint' : 'text-success'}`} title={observation.text}>{observation.text}</p><p className="text-ink-faint mt-1 text-xs">参照切れ <MetricCell metric={item.brokenReferences} /></p></td><td className="px-3 py-2"><div className="flex justify-end gap-2 whitespace-nowrap"><Button href={item.href} variant="secondary">中身を見る</Button>{canTidyUsage(item) && <Button href={item.href} variant="secondary" className="border-warning text-warning">片づける</Button>}</div></td></tr>
      })}</tbody>
    </table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="text-ink-faint">未使用の項目は自動で削除しません。各機能の使用先を確認してから停止・削除します。</p>
      <p className="text-ink-faint">利用関係を最後に確認: {formatAnalyticsDateTime(overview.checkedAt)}</p>
    </div>
  </div>
}

function UrlClicksOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const state = useOverview<AnalyticsUrlClicksOverview>(
    () => api.analytics.urlClicksOverview(accountId, { ...range, limit: 200 }),
    `${accountId}:${range.from}:${range.to}:url-clicks`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  return <div data-design-node="Fh2Qj" className="space-y-4">
    {overview.stateReason && <div className="bg-warning-bg border-warning rounded-card border px-4 py-3 text-sm">{overview.stateReason}</div>}
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>URL名</Th><Th>リンク先</Th><Th align="right">クリック</Th><Th align="right">実人数</Th><Th align="right">届いた人数</Th><Th align="right">クリック率</Th><Th>使われた場所</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.links.length === 0 ? <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">この期間に集計できるURLはありません</td></tr> : overview.links.map((item) => <tr key={item.trackedLinkId} className="text-sm"><td className="truncate px-3 py-3 font-medium" title={item.name}>{item.name}{!item.isActive && <span className="text-ink-faint ml-1 text-xs">停止</span>}</td><td className="text-ink-secondary truncate px-3 py-3" title={item.originalUrl}>{item.originalUrl}</td><td className="px-2 py-3 text-right"><MetricCell metric={item.clicks} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.knownClickPeople} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.deliveredPeople} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.clickRate} percent /></td><td className="text-ink-secondary truncate px-3 py-3" title={item.usageLocations.join('、')}>{item.usageLocations.length ? item.usageLocations.join('、') : '—'}</td></tr>)}</tbody>
    </table></div>
    <p className="text-ink-faint text-xs">{overview.clickRateDefinition}</p>
  </div>
}

const SAVED_STATE_LABELS: Record<SavedAnalyticsSnapshot['state'], string> = {
  available: '利用可能',
  partial: '一部集計',
  unavailable: '取得不可',
  failed: '失敗',
}

const SAVED_STATE_TONES: Record<SavedAnalyticsSnapshot['state'], ChipTone> = {
  available: 'ok',
  partial: 'warn',
  unavailable: 'danger',
  failed: 'danger',
}

function SavedAnalyticsTab({ accountId }: { accountId: string }) {
  const [items, setItems] = useState<SavedAnalyticsSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshots, setSnapshots] = useState<SavedAnalyticsSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setItems([])
    setSelectedId('')
    setSnapshots([])
    setError('')
    void api.analytics.saved
      .list(accountId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setItems(response.data)
        setSelectedId(response.data[0]?.id ?? '')
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '保存した分析を確認できませんでした')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId])

  useEffect(() => {
    if (!selectedId) {
      setSnapshots([])
      return
    }
    let active = true
    setSnapshotLoading(true)
    setSnapshots([])
    void api.analytics.saved
      .snapshots(accountId, selectedId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setSnapshots(response.data)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '結果の履歴を確認できませんでした')
      })
      .finally(() => {
        if (active) setSnapshotLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId, selectedId])

  const selected = items.find((item) => item.id === selectedId) ?? null

  return (
    <div data-design-node="dfwD4" className="space-y-4">
      <div className="bg-info-bg border-info rounded-card border px-4 py-3 text-sm">
        <p className="text-ink font-medium">条件の定義と集計結果を分けて保存しています</p>
        <p className="text-ink-secondary mt-1 text-xs">
          あとから条件が変わっても、保存時点の結果は書き換わりません。定期レポートは現在「なし」です。
        </p>
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-10 text-center text-sm">
          保存した分析を読み込んでいます
        </div>
      ) : error && items.length === 0 ? (
        <div className="bg-danger-bg rounded-card border-danger text-danger border p-6 text-sm">{error}</div>
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border p-10 text-center">
          <p className="text-ink font-medium">保存した分析はまだありません</p>
          <p className="text-ink-faint mt-2 text-sm">クロス分析かファネルを集計し、その結果を保存してください。</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">保存した分析</h2>
              <span className="text-ink-faint text-xs">{items.length}件</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed">
                <thead>
                  <TableHeadRow>
                    <Th>分析名</Th>
                    <Th>種類</Th>
                    <Th>作成者</Th>
                    <Th>定義版</Th>
                    <Th>最新の期間</Th>
                    <Th>集計状態</Th>
                    <Th align="right">結果</Th>
                  </TableHeadRow>
                </thead>
                <tbody className="divide-hairline divide-y">
                  {items.map((item) => {
                    const active = selectedId === item.id
                    return (
                      <tr key={item.id} className={active ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'}>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            className="text-ink w-full truncate px-4 py-3 text-left text-sm font-medium"
                            title={item.name}
                            aria-pressed={active}
                          >
                            {item.name}
                          </button>
                        </td>
                        <td className="text-ink-secondary px-3 py-3 text-sm">{item.kind === 'cross' ? 'クロス分析' : 'ファネル'}</td>
                        <td className="text-ink-secondary truncate px-3 py-3 text-sm" title={item.createdByName}>{item.createdByName}</td>
                        <td className="text-ink-secondary px-3 py-3 text-sm">第{item.currentVersionNumber}版</td>
                        <td className="text-ink-secondary px-3 py-3 text-xs tabular-nums">
                          {item.latestSnapshot
                            ? `${item.latestSnapshot.periodFrom.slice(0, 10)}〜${item.latestSnapshot.periodTo.slice(0, 10)}`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {item.latestSnapshot ? (
                            <Chip tone={SAVED_STATE_TONES[item.latestSnapshot.state]}>
                              {SAVED_STATE_LABELS[item.latestSnapshot.state]}
                            </Chip>
                          ) : <span className="text-ink-faint">—</span>}
                        </td>
                        <td className="text-ink-secondary px-3 py-3 text-right text-sm">{item.snapshotCount}件</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink text-sm font-semibold">結果の履歴</h2>
            {selected && (
              <p className="text-ink-faint mt-1 truncate text-xs" title={selected.name}>
                {selected.name} ／ 定期レポート なし
              </p>
            )}
            {error && items.length > 0 && <p className="text-danger mt-3 text-xs">{error}</p>}
            {snapshotLoading ? (
              <p className="text-ink-faint mt-4 text-sm">結果を読み込んでいます</p>
            ) : snapshots.length === 0 ? (
              <p className="text-ink-faint mt-4 text-sm">保存された結果はありません</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {snapshots.map((snapshot) => (
                  <li key={snapshot.id} className="border-hairline rounded-control border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink text-xs font-medium">
                        {snapshot.sourceKind === 'cross' ? 'クロス分析' : 'ファネル'}
                      </span>
                      <span className="text-ink-faint text-xs">{SAVED_STATE_LABELS[snapshot.state]}</span>
                    </div>
                    <p className="text-ink-secondary mt-2 text-xs tabular-nums">
                      {snapshot.periodFrom.slice(0, 10)}〜{snapshot.periodTo.slice(0, 10)}
                    </p>
                    <p className="text-ink-faint mt-1 text-xs tabular-nums">
                      データ締切 {formatAnalyticsDateTime(snapshot.dataCutoffAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function AnalyticsInner() {
  const tab = useMergedTab(TABS)
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [canManage, setCanManage] = useState(false)

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active || !response.success) return
      setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => {
      active = false
    }
  }, [])
  if (accountLoading) {
    return <div className="text-ink-faint p-8 text-center text-sm">分析を読み込んでいます</div>
  }
  if (!selectedAccountId) {
    return <div className="text-ink-faint p-8 text-center text-sm">LINE公式アカウントを選んでください</div>
  }
  return (
    <div data-analytics-design="v6">
      <MergedTabs basePath="/analytics" tabs={TABS} active={tab} />
      {tab === 'friends' && <FriendsOverviewTab accountId={selectedAccountId} />}
      {tab === 'reactions' && <ReactionsOverviewTab accountId={selectedAccountId} />}
      {tab === 'routes' && <RoutesOverviewTab accountId={selectedAccountId} />}
      {tab === 'usage' && <UsageOverviewTab accountId={selectedAccountId} />}
      {tab === 'cross' && <CrossTab accountId={selectedAccountId} canManage={canManage} />}
      {tab === 'funnel' && <FunnelTab accountId={selectedAccountId} canManage={canManage} />}
      {tab === 'url-clicks' && <UrlClicksOverviewTab accountId={selectedAccountId} />}
      {tab === 'saved' && <SavedAnalyticsTab accountId={selectedAccountId} />}
    </div>
  )
}

export default function AnalyticsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AnalyticsInner />
    </Suspense>
  )
}
