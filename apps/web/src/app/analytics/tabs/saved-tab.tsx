'use client'

import { useEffect, useState } from 'react'
import { api, type SavedAnalyticsSnapshot, type SavedAnalyticsSummary } from '@/lib/api'
import Chip from '@/components/shared/chip'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { formatAnalyticsDateTime } from '../analytics-time'
import {
  AnalyticsExportButton,
  SAVED_STATE_LABELS,
  SAVED_STATE_TONES,
  downloadCsv,
} from './analytics-shared'

export function SavedAnalyticsTab({ accountId, onCountChange }: { accountId: string; onCountChange?: (count: number | null) => void }) {
  const [items, setItems] = useState<SavedAnalyticsSummary[]>([])
  const [query, setQuery] = useState('')
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
        // 件数表示はこの取得結果を使い回す(点検#508軽9)。タブ名のためだけにもう1回叩かない。
        onCountChange?.(response.data.length)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '保存した分析を確認できませんでした')
        onCountChange?.(null)
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
  const visibleItems = items.filter((item) => `${item.name} ${item.createdByName}`.toLowerCase().includes(query.trim().toLowerCase()))
  const staleCount = items.filter((item) => item.latestSnapshot && ['unavailable', 'failed'].includes(item.latestSnapshot.state)).length
  const exportSaved = () => downloadCsv('analytics-saved.csv', [
    ['分析名', '種類', '作った人', '定義版', '更新日時', '集計状態', '保存結果数'],
    ...visibleItems.map((item) => [
      item.name,
      item.kind === 'cross' ? 'クロス分析' : 'ファネル',
      item.createdByName,
      item.currentVersionNumber,
      item.updatedAt,
      item.latestSnapshot ? SAVED_STATE_LABELS[item.latestSnapshot.state] : null,
      item.snapshotCount,
    ]),
  ])

  return (
    <div data-design-node="dfwD4" className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard title="保存した分析" value={items.length} unit="件" detail="クロス分析とファネル" loading={loading} />
        <KpiCard title="保存した結果" value={items.reduce((sum, item) => sum + item.snapshotCount, 0)} unit="件" detail="時点ごとに固定した結果" loading={loading} />
        <KpiCard title="定義が古いもの" value={staleCount} unit="件" detail="取得不可・失敗の最新結果" loading={loading} />
        <KpiCard title="選んだ分析の履歴" value={selected ? selected.snapshotCount : null} unit="件" detail={selected?.name ?? '分析を選んでください'} loading={loading} />
      </div>
      <div className="bg-info-bg border-info rounded-card border px-4 py-3 text-sm">
        <p className="text-ink font-medium">条件の定義と集計結果を分けて保存しています</p>
        <p className="text-ink-secondary mt-1 text-xs">
          あとから条件が変わっても、保存時点の結果は書き換わりません。定期レポートは現在「なし」です。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="saved-analysis-search" className="sr-only">分析名・作った人で探す</label>
        <input id="saved-analysis-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="分析名・作った人で探す" className="h-10 min-w-64 flex-1 rounded-control border border-hairline bg-canvas px-3 text-sm" />
        <AnalyticsExportButton onClick={exportSaved} disabled={visibleItems.length === 0} />
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
            <div className="overflow-hidden">
              <table className="w-full table-fixed">
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
                  {visibleItems.map((item) => {
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
