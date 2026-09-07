'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { Th } from '@/components/shared/table'
import { api } from '@/lib/api'
import type { IdentityCandidateListItem } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'

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
  usePageTitle('重複検出')
  const [data, setData] = useState<DuplicatesStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState<IdentityCandidateListItem[]>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    if (opts?.forceRefresh) setRefreshing(true)
    setError('')
    try {
      const [statsRes, candidatesRes] = await Promise.all([
        api.duplicates.stats(opts),
        api.identityCandidates.list({
          kind: 'friend_duplicate',
          status: status ? status as 'pending' | 'linked' | 'different' | 'deferred' : undefined,
          limit: 50,
          offset: 0,
        }),
      ])
      if (statsRes.success && candidatesRes.success) {
        setData(statsRes.data)
        setCandidates(candidatesRes.data.items)
        setCandidateTotal(candidatesRes.data.total)
      } else {
        setError('読み込めませんでした')
      }
    } catch {
      setError('読み込めませんでした')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [status])

  const detect = async () => {
    setRefreshing(true)
    setError('')
    try {
      const result = await api.identityCandidates.detectFriendDuplicates({ limit: 100 })
      if (!result.success) throw new Error('failed')
      await load({ forceRefresh: true })
    } catch {
      setError('重複候補を再検出できませんでした。表示中の候補は前回の結果です。')
      setRefreshing(false)
    }
  }

  const visibleCandidates = candidates.filter((candidate) => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    if (!needle) return true
    return [candidate.left.label, candidate.right.label, ...candidate.evidenceSummary]
      .some((value) => value.toLocaleLowerCase('ja-JP').includes(needle))
  })

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
      <section className="rounded-card border border-hairline bg-canvas px-4 py-3 shadow-card">
        <p className="text-sm font-bold text-ink">重複の可能性を検出します。自動統合はしません。</p>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">確定済みID・連携UID・メール／電話の一致は強い根拠、プロフィール画像や名前だけの一致は候補として表示します。確認後も元のLINE友だちデータは残ります。</p>
      </section>

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
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="重複候補" value={`${fmt.format(candidateTotal)}組`} hint={`${fmt.format(candidates.filter((item) => item.status === 'pending').length)}組を確認待ち`} />
            <StatCard label="確認済み" value={`${fmt.format(candidates.filter((item) => item.status === 'linked').length)}組`} hint="統合ユーザーに紐付け済み" />
            {/*
              friendDups は「重複した登録の行数」。送った通数ではない。
              以前はこれを「余分な配信回数」「1配信あたり浪費 ¥X」と言い切り、
              さらに設計にない「月10本配信なら」という前提まで作っていた。
              配信実績が繋がるまでは、数えられる行数だけを行数として出す。
            */}
            <StatCard
              label="重複配信の削減"
              value="—"
              hint="配信前プレビューの実績を接続後に表示"
            />
            <StatCard
              label="1配信あたりの無駄"
              value={`¥${fmt.format(data.wastedPerBroadcastYen)}`}
              hint={`¥${fmt.format(data.msgUnitYen)}/通の見積り`}
            />
            <StatCard label="根拠不足" value={`${fmt.format(candidates.filter((item) => item.confidence.label === 'low').length)}組`} hint="名前・画像だけの候補" />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#565F59]">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・メール・電話で検索" className="h-10 min-w-60 rounded-control border border-hairline bg-canvas px-3 text-sm" />
              <Select
                aria-label="状態で絞り込む"
                label="状態"
                value={status}
                onChange={setStatus}
                options={[
                  { value: '', label: 'すべて' },
                  { value: 'pending', label: '未確認' },
                  { value: 'linked', label: '確認済み' },
                  { value: 'deferred', label: '保留' },
                  { value: 'different', label: '別人' },
                ]}
              />
            </div>
            <div className="flex items-center gap-3">
              {data.computedAt && (
                <span className="text-xs text-[#8B938D]">
                  {formatRelative(data.computedAt)}に計算
                </span>
              )}
              <button
                type="button"
                onClick={() => void detect()}
                disabled={refreshing}
                className="h-9 rounded-[9px] border border-[#DADDE2] bg-white px-3 text-xs font-semibold text-[#565F59] hover:bg-[#F6F6F8] disabled:opacity-50"
              >
                {refreshing ? '再検出中…' : '重複を再検出'}
              </button>
            </div>
          </div>

          <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card">
            <table className="w-full table-fixed text-sm">
              <colgroup><col style={{ width: '18%' }}/><col style={{ width: '10%' }}/><col style={{ width: '27%' }}/><col style={{ width: '18%' }}/><col style={{ width: '12%' }}/><col style={{ width: '8%' }}/><col style={{ width: '12%' }}/></colgroup>
              <thead className="border-b border-hairline bg-canvas-sunken text-left text-micro font-semibold text-ink-secondary"><tr><Th className="py-3">候補</Th><Th className="py-3">確信度</Th><Th className="py-3">一致した根拠</Th><Th className="py-3">所属アカウント</Th><Th className="py-3">最終更新</Th><Th className="py-3">状態</Th><Th className="py-3">操作</Th></tr></thead>
              <tbody className="divide-y divide-hairline">
                {visibleCandidates.length ? visibleCandidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td className="truncate px-3 py-3 font-semibold text-ink" title={`${candidate.left.label} ↔ ${candidate.right.label}`}>{candidate.left.label} ↔ {candidate.right.label}</td>
                    <td className="px-3 py-3 text-ink-secondary">{candidate.confidence.label === 'very_high' ? '最高' : candidate.confidence.label === 'high' ? '高' : candidate.confidence.label === 'medium' ? '中' : '低'}</td>
                    <td className="truncate px-3 py-3 text-ink-secondary" title={candidate.evidenceSummary.join('・')}>{candidate.evidenceSummary.join('・') || '根拠を確認'}</td>
                    <td className="truncate px-3 py-3 text-ink-secondary">{[candidate.left.lineAccountName, candidate.right.lineAccountName].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-3 text-ink-secondary">{new Date(candidate.reviewedAt ?? candidate.detectedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{candidate.status === 'pending' ? '未確認' : candidate.status === 'linked' ? '確認済み' : candidate.status === 'deferred' ? '保留' : '別人'}</td>
                    <td className="px-3 py-2"><Button href={`/friends/identity-candidates?id=${encodeURIComponent(candidate.id)}`} variant="primary">重複候補を確認</Button></td>
                  </tr>
                )) : <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-ink-faint">条件に合う重複候補はありません</td></tr>}
              </tbody>
            </table>
            <div className="border-t border-hairline px-4 py-3 text-xs text-ink-faint">{fmt.format(candidateTotal)}組中 1〜{fmt.format(visibleCandidates.length)}組</div>
          </section>

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
