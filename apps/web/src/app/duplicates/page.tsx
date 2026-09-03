'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import { useEmbeddedPage } from '@/components/layout/embedded-page-context'
import { api } from '@/lib/api'

interface PerAccountStat {
  accountId: string
  accountName: string
  friends: number
  dups: number
  dupRate: number
}

interface PairwiseOverlap {
  fromAccountId: string
  toAccountId: string
  overlap: number
}

interface DuplicatesStatsData {
  totalFollowing: number
  uniquePeople: number
  friendDups: number
  duplicateGroups: number
  // 送信実績ではなく friendDups × 単価の見積り。実績が繋がるまで画面には出さない。
  wastedPerBroadcastYen: number
  msgUnitYen: number
  perAccount: PerAccountStat[]
  // Optional: an older worker deployment (mid-rollout) may not include this
  // field. Guarded at every access site below; do not assume non-empty.
  pairwiseOverlap?: PairwiseOverlap[]
  // Optional during rolling deploys.
  computedAt?: string
}

function formatRelative(iso: string): string {
  const elapsedMs = Date.now() - new Date(iso).getTime()
  if (elapsedMs < 0) return 'たった今'
  const sec = Math.floor(elapsedMs / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  return `${hr}時間前`
}

const fmt = new Intl.NumberFormat('ja-JP')

export default function DuplicatesPage() {
  const embedded = useEmbeddedPage()
  const [data, setData] = useState<DuplicatesStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    if (opts?.forceRefresh) setRefreshing(true)
    setError('')
    try {
      const res = await api.duplicates.stats(opts)
      if (res.success) {
        setData(res.data)
      } else {
        setError('読み込めませんでした')
      }
    } catch {
      setError('読み込めませんでした')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Tick once a minute so the "○分前に計算" label keeps refreshing while
  // the operator leaves the page open. setNow reads Date.now() implicitly
  // on the next render via formatRelative.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-4" data-duplicates-design="v4">
      {!embedded ? (
        <Header
          title="重複検出"
          description="複数アカウントに重複している友だちを把握し、配信コストの無駄を減らすためのビューです。"
        />
      ) : null}

      {loading && !data ? (
        <div className="rounded-[14px] border border-[#DADDE2] bg-white p-8 text-center text-[#565F59] shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
          読み込んでいます
        </div>
      ) : !data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>読み込めませんでした</p>
          <div className="mt-2">
            <Button variant="secondary" onClick={() => load()}>再読み込み</Button>
          </div>
        </div>
      ) : (
        <>
          {/* When a refresh fails but we still have a previous snapshot, show
              the error inline above the data instead of replacing the whole
              page — losing the dashboard for a transient 500 is worse than
              showing slightly stale numbers with a warning. */}
          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              再計算できませんでした。表示中の数字は前回の集計です。
            </div>
          )}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="友だち総数" value={fmt.format(data.totalFollowing)} />
            <StatCard label="ユニーク人数" value={fmt.format(data.uniquePeople)} />
            {/*
              friendDups は「重複した登録の行数」。送った通数ではない。
              以前はこれを「余分な配信回数」「1配信あたり浪費 ¥X」と言い切り、
              さらに設計にない「月10本配信なら」という前提まで作っていた。
              配信実績が繋がるまでは、数えられる行数だけを行数として出す。
            */}
            <StatCard
              label="重複している行"
              value={fmt.format(data.friendDups)}
              hint="複数登録による余分"
            />
            <StatCard
              label="重複による配信コスト"
              value="—"
              hint="まだ繋がっていません。配信実績が接続されると表示されます。"
            />
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-[#565F59]">
            <div className="flex items-center gap-3">
              {data.computedAt && (
                <span className="text-xs text-[#8B938D]">
                  {formatRelative(data.computedAt)}に計算
                </span>
              )}
              <button
                type="button"
                onClick={() => load({ forceRefresh: true })}
                disabled={refreshing}
                className="h-9 rounded-[9px] border border-[#DADDE2] bg-white px-3 text-xs font-semibold text-[#565F59] hover:bg-[#F6F6F8] disabled:opacity-50"
              >
                {refreshing ? '再計算中…' : '再計算'}
              </button>
            </div>
          </div>

          <section>
            <h2 className="text-sm font-bold text-[#1D1D1F]">アカウント別ブレイクダウン</h2>
            {data.perAccount.length === 0 ? (
              <p className="mt-3 text-sm text-[#8B938D]">アカウントが登録されていません。</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-[14px] border border-[#DADDE2] bg-white shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
                <table className="w-full table-fixed text-sm">
                  <thead className="border-b border-[#DADDE2] bg-[#F6F6F8] text-left text-[11px] font-semibold text-[#565F59]">
                    <tr>
                      <th className="px-4 py-3">アカウント</th>
                      <th className="px-4 py-3 text-right">友だち数</th>
                      <th className="px-4 py-3 text-right">うち重複</th>
                      <th className="px-4 py-3 text-right">重複率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAEBED] bg-white text-[#565F59]">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td className="truncate px-4 py-3 font-semibold text-[#1D1D1F]" title={row.accountName}>{row.accountName}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.friends)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.dups)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {(row.dupRate * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.perAccount.length >= 2 && data.pairwiseOverlap && (() => {
            // Bind the optional array to a local so the inner map closures
            // keep the non-undefined narrowing.
            const pairwise = data.pairwiseOverlap
            return (
            <section>
              <h2 className="text-sm font-bold text-[#1D1D1F]">アカウント間 重複マトリックス</h2>
              <p className="mt-1 text-xs text-[#8B938D]">
                行アカウントの友だちのうち、列アカウントにも居る人数 （行のアカウントに対する割合）。
              </p>
              <div className="mt-3 overflow-hidden rounded-[14px] border border-[#DADDE2] bg-white shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
                <table className="w-full table-fixed text-sm">
                  <thead className="border-b border-[#DADDE2] bg-[#F6F6F8] text-left text-[11px] font-semibold text-[#565F59]">
                    <tr>
                      <th className="px-4 py-3">行 \ 列</th>
                      {data.perAccount.map((col) => (
                        <th
                          key={col.accountId}
                          title={col.accountName}
                          className="truncate px-2 py-3 text-right"
                        >
                          {col.accountName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAEBED] bg-white text-[#565F59]">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td title={row.accountName} className="truncate px-2 py-3 font-semibold text-[#1D1D1F]">
                          {row.accountName}
                        </td>
                        {data.perAccount.map((col) => {
                          if (row.accountId === col.accountId) {
                            return (
                              <td
                                key={col.accountId}
                                className="px-4 py-3 text-right text-[#B8BCC2]"
                              >
                                —
                              </td>
                            )
                          }
                          const pair = pairwise.find(
                            (p) =>
                              p.fromAccountId === row.accountId &&
                              p.toAccountId === col.accountId,
                          )
                          const overlap = pair?.overlap ?? 0
                          const rate = row.friends > 0 ? overlap / row.friends : 0
                          return (
                            <td
                              key={col.accountId}
                              className="px-2 py-3 text-right tabular-nums"
                            >
                              {fmt.format(overlap)}{' '}
                              <span className="text-xs text-[#8B938D]">
                                ({(rate * 100).toFixed(0)}%)
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            )
          })()}
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-[14px] border border-[#DADDE2] bg-white p-4 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
      <div className="text-xs font-medium text-[#565F59]">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-[#1D1D1F]">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[#8B938D]">{hint}</div> : null}
    </div>
  )
}
