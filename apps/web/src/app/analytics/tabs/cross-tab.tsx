'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FriendField } from '@line-crm/shared'
import { api, type AnalyticsCrossAxis, type AnalyticsCrossResult } from '@/lib/api'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import KpiCard from '@/components/shared/kpi-card'
import { formatAnalyticsDateTime } from '../analytics-time'
import {
  AnalyticsExportButton,
  AnalyticsNotice,
  RangePicker,
  SaveAnalysisAction,
  downloadCsv,
  explainStartError,
} from './analytics-shared'

export function CrossTab({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const [fields, setFields] = useState<FriendField[]>([])
  // 友だち情報欄が取れないのに空表示のままにすると、項目を作り直す事故になる。
  const [fieldsError, setFieldsError] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [rowKind, setRowKind] = useState<'tag' | 'route' | 'score_band' | 'conversion_point' | 'booking_status' | 'purchase_status'>('tag')
  const [crossResult, setCrossResult] = useState<AnalyticsCrossResult | null>(null)
  const [crossRunId, setCrossRunId] = useState('')
  const [crossResultId, setCrossResultId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [crossDays, setCrossDays] = useState(30)
  const [audience, setAudience] = useState<{ id: string; memberCount: number; expiresAt: string } | null>(null)
  const [picked, setPicked] = useState<{
    row: string
    col: string
    rowKey: string
    columnKey: string
    count: number
  } | null>(null)

  useEffect(() => {
    let active = true
    setFieldsError('')
    void api.friendFields.list(accountId).then((res) => {
      if (!active) return
      if (res.success) {
        setFields(res.data)
        if (res.data.length > 0) setFieldId(res.data[0].id)
      } else {
        setFieldsError(res.error || '友だち情報欄を読み込めませんでした')
      }
    }).catch(() => {
      if (active) setFieldsError('友だち情報欄を読み込めませんでした')
    })
    return () => {
      active = false
    }
  }, [accountId])

  useEffect(() => {
    setCrossResult(null)
    setCrossRunId('')
    setCrossResultId('')
    setPicked(null)
    setAudience(null)
    setError('')
  }, [accountId])

  // 結果待ちの読み直し。終わらない集計があると無限に叩き続け、端末の電池と
  // 回線、D1の読み取り枠を消費する。40回で打ち切り、間隔は段階的に延ばす。
  useEffect(() => {
    if (!crossRunId) return
    let active = true
    let timer: number | undefined
    let attempts = 0
    const check = async () => {
      attempts += 1
      try {
        const response = await api.analytics.crossResult(accountId, crossRunId)
        if (!active) return
        if (!response.success) throw new Error(response.error)
        if (response.data.result) {
          setCrossResult(response.data.result)
          setCrossRunId('')
          setLoading(false)
          return
        }
        if (response.data.state === 'failed') {
          setError(response.data.errorCode || 'クロス分析に失敗しました')
          setCrossRunId('')
          setLoading(false)
          return
        }
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'クロス分析を確認できませんでした')
        setCrossRunId('')
        setLoading(false)
        return
      }
      if (!active) return
      if (attempts >= 40) {
        setError('時間切れです。条件をゆるめて集計し直してください')
        setCrossRunId('')
        setLoading(false)
        return
      }
      timer = window.setTimeout(() => void check(), attempts < 10 ? 1500 : attempts < 30 ? 3000 : 5000)
    }
    void check()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
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
    const from = new Date(now.getTime() - crossDays * 24 * 3600_000)
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
      const code = caught instanceof Error ? caught.message : ''
      setError(explainStartError(code, code || 'クロス分析を開始できませんでした'))
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

  const exportCross = () => {
    if (!crossResult) return
    downloadCsv('analytics-cross.csv', [
      [`${rowLabel} ＼ ${fieldName}`, ...cols.map((column) => column.label), '合計'],
      ...rows.map((row) => [
        row.label,
        ...cols.map((column) => lookup.get(`${row.key}\u0000${column.key}`) ?? 0),
        rowTotals.get(row.key) ?? 0,
      ]),
      ['合計', ...cols.map((column) => colTotals.get(column.key) ?? 0), grandTotal],
    ])
  }

  if (fieldsError) {
    return (
      <p className="text-danger bg-danger-bg border-danger rounded-card border p-8 text-center text-sm" role="alert">
        友だち情報欄を読み込めませんでした。開き直してください。
      </p>
    )
  }

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
    <div data-design-node="f5HsX" className="space-y-4">
      <div className="flex justify-end"><AnalyticsExportButton onClick={exportCross} disabled={!crossResult} /></div>
      <AnalyticsNotice>数えているのは、こちらで観測できたことだけです。LINEで開かれたかどうかは取れないため、この画面には出しません。</AnalyticsNotice>
      <p className="text-sm text-ink-secondary">タグや友だち情報を掛け合わせて、友だちが何人いるかを表にします。数字を押すとその人たちを抽出でき、そのまま配信できます。</p>

      <section className="bg-canvas rounded-card border-hairline border p-4">
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
            {loading ? '集計中' : `この${crossDays}日を集計`}
          </Button>
        </div>
        <dl className="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-ink-secondary">数えるもの</dt><dd className="mt-1 text-sm text-ink">友だちの人数（重複なし）</dd></div>
          <div><dt className="mb-1 text-xs font-medium text-ink-secondary">期間</dt><dd><RangePicker days={crossDays} onChange={setCrossDays} /></dd></div>
        </dl>
        <p className="text-ink-faint mt-2 text-xs">
          集計結果はその時点のデータで固定します。期間や軸を変えた場合は、新しい結果として集計します。
        </p>
        <p className="mt-1 text-xs text-ink-faint">追加条件を最大15個指定するには、クロス分析APIの追加条件の接続が必要です。</p>
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
          たて・よこの軸を選び、「この{crossDays}日を集計」を押してください。
        </div>
      ) : cells.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          {crossResult.state === 'unavailable'
            ? crossResult.stateReason || 'この分析に必要なデータを取得できません。'
            : 'この条件に該当する人はいません。'}
        </div>
      ) : (
        <>
          <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <table className="w-full table-fixed">
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
