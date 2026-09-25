'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import { TableStateRow } from '@/components/shared/table'
import { api } from '@/lib/api'
import type { IdentityCandidateListItem, IdentityCandidateStatus } from '@line-crm/shared'
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

const CANDIDATE_PAGE_SIZE = 50

export default function DuplicatesPage() {
  usePageTitle('重複検出')
  const [data, setData] = useState<DuplicatesStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState<IdentityCandidateListItem[]>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Partial<Record<IdentityCandidateStatus, number>>>({})
  const [lowConfidenceCount, setLowConfidenceCount] = useState(0)
  const [query, setQuery] = useState('')
  // FRIEND-11: 検索はサーバーへ渡して全件へかける。入力中の逐次送信を避けるため debounce。
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  /*
   * FRIEND-12: 状態切替で先行した要求の応答が後から届いても採用しない。
   * 番号の新しい要求だけを採用し、検索キー（状態・検索語・ページ）も
   * 照合して「選んだ条件」と「出ている結果」がずれないようにする。
   */
  const candidatesReqRef = useRef(0)
  const candidatesKeyRef = useRef('')
  const statsReqRef = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  // 条件を変えたら1ページ目へ戻す（FRIEND-11）。
  useEffect(() => {
    setPage(1)
  }, [debouncedQuery, status])

  const loadStats = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    if (opts?.forceRefresh) setRefreshing(true)
    const req = ++statsReqRef.current
    try {
      const statsRes = await api.duplicates.stats(opts)
      if (req !== statsReqRef.current) return
      if (statsRes.success) {
        setData(statsRes.data)
        setError('')
      } else {
        setError('読み込めませんでした')
      }
    } catch {
      if (req !== statsReqRef.current) return
      setError('読み込めませんでした')
    } finally {
      if (req === statsReqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  const loadCandidates = useCallback(async () => {
    const req = ++candidatesReqRef.current
    const key = JSON.stringify({ status, q: debouncedQuery.trim(), page })
    candidatesKeyRef.current = key
    setCandidatesLoading(true)
    setCandidateError('')
    try {
      const res = await api.identityCandidates.list({
        kind: 'friend_duplicate',
        // FRIEND-11: 「すべて」は本当に全状態を見る（従来は pending だけだった）。
        status: (status || 'all') as IdentityCandidateStatus | 'all',
        q: debouncedQuery.trim() || undefined,
        limit: CANDIDATE_PAGE_SIZE,
        offset: (page - 1) * CANDIDATE_PAGE_SIZE,
      })
      // 古い応答・別条件の応答は捨てる（FRIEND-12）。
      if (req !== candidatesReqRef.current || candidatesKeyRef.current !== key) return
      if (res.success) {
        setCandidates(res.data.items)
        setCandidateTotal(res.data.total)
        setStatusCounts(res.data.statusCounts ?? {})
        setLowConfidenceCount(res.data.lowConfidenceCount ?? 0)
      } else {
        // FRIEND-12: 失敗を「新しい条件の0件」と誤認させない。
        setCandidates([])
        setCandidateTotal(0)
        setCandidateError('候補一覧を読み込めませんでした')
      }
    } catch {
      if (req !== candidatesReqRef.current || candidatesKeyRef.current !== key) return
      setCandidates([])
      setCandidateTotal(0)
      setCandidateError('候補一覧を読み込めませんでした')
    } finally {
      if (req === candidatesReqRef.current) setCandidatesLoading(false)
    }
  }, [status, debouncedQuery, page])

  const load = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    await Promise.all([loadStats(opts), loadCandidates()])
  }, [loadStats, loadCandidates])

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

  const candidatePageCount = Math.max(1, Math.ceil(candidateTotal / CANDIDATE_PAGE_SIZE))
  const rangeStart = candidateTotal === 0 ? 0 : (page - 1) * CANDIDATE_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * CANDIDATE_PAGE_SIZE, candidateTotal)

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

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
        <div className="rounded-[14px] border border-[#DADDE2] bg-white p-8 text-center text-[#565F59] shadow-card">
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
          {/*
            #1005: 独自カードをやめて共通 KpiCard の3段（見出し・数値・短い状態）に
            揃える。見積りの前提などの長い説明は説明アイコンの中へ移し、
            カード行を補足文の長さで伸ばさない。
          */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {/*
              FRIEND-11: 集計カードは読み込んだ1ページ分ではなく、同じ検索条件の
              全件を数えた statusCounts / lowConfidenceCount で出す。
              （読み込み50件で頭打ちにならない。）
            */}
            <KpiCard title="重複候補" value={null} unit="" valueText={`${fmt.format(Object.values(statusCounts).reduce((sum, n) => sum + (n ?? 0), 0))}組`} detail={`${fmt.format(statusCounts.pending ?? 0)}組を確認待ち`} />
            <KpiCard title="確認済み" value={null} unit="" valueText={`${fmt.format(statusCounts.linked ?? 0)}組`} detail="統合ユーザーに紐付け済み" />
            {/*
              friendDups は「重複した登録の行数」。送った通数ではない。
              以前はこれを「余分な配信回数」「1配信あたり浪費 ¥X」と言い切り、
              さらに設計にない「月10本配信なら」という前提まで作っていた。
              配信実績が繋がるまでは、数えられる行数だけを行数として出す。
            */}
            <KpiCard
              title="重複配信の削減"
              value={null}
              unit=""
              valueText="—"
              detail="配信実績の接続を待っています"
              description="配信前プレビューの実績を接続したあと、重複分を除いた削減の見込みをここに表示します。"
            />
            <KpiCard
              title="1配信あたりの無駄"
              value={null}
              unit=""
              valueText={`¥${fmt.format(data.wastedPerBroadcastYen)}`}
              detail={`¥${fmt.format(data.msgUnitYen)}/通の見積り`}
              description="重複している友だち登録の数に1通あたりの単価を掛けた見積りです。実際に送った配信の実績ではありません。"
            />
            <KpiCard title="根拠不足" value={null} unit="" valueText={`${fmt.format(lowConfidenceCount)}組`} detail="名前・画像だけの候補" />
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

          <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card" aria-busy={candidatesLoading}>
            <table className="w-full table-fixed text-sm">
              <colgroup><col style={{ width: '17%' }}/><col style={{ width: '8%' }}/><col style={{ width: '24%' }}/><col style={{ width: '17%' }}/><col style={{ width: '11%' }}/><col style={{ width: '8%' }}/><col style={{ width: '15%' }}/></colgroup>
              {/*
                #984 LAY-12: 見出しは共通の TableHeadRow（高さ44px・
                背景・罫線を部品側で持つ）。セルの外付け余白で高さを
                作らない。ページ内のほかの表と同じ見出し規則にそろえる。
              */}
              <thead><TableHeadRow><Th>候補</Th><Th>確信度</Th><Th>一致した根拠</Th><Th>所属アカウント</Th><Th>最終更新</Th><Th>状態</Th><Th>操作</Th></TableHeadRow></thead>
              <tbody className="divide-y divide-hairline">
                {candidateError ? (
                  <TableStateRow
                    colSpan={7}
                    kind="error"
                    title={candidateError}
                    onRetry={() => void loadCandidates()}
                    retryLabel="再試行"
                  />
                ) : candidatesLoading && candidates.length === 0 ? (
                  // FRIEND-12: 応答待ちを「0件」と見せない。
                  <TableStateRow colSpan={7} kind="loading" title="読み込んでいます…" />
                ) : candidates.length ? candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td className="truncate px-3 py-3 font-semibold text-ink" title={`${candidate.left.label} ↔ ${candidate.right.label}`}>{candidate.left.label} ↔ {candidate.right.label}</td>
                    <td className="px-3 py-3 text-ink-secondary">{candidate.confidence.label === 'very_high' ? '最高' : candidate.confidence.label === 'high' ? '高' : candidate.confidence.label === 'medium' ? '中' : '低'}</td>
                    <td className="truncate px-3 py-3 text-ink-secondary" title={candidate.evidenceSummary.join('・')}>{candidate.evidenceSummary.join('・') || '根拠を確認'}</td>
                    <td className="truncate px-3 py-3 text-ink-secondary">{[candidate.left.lineAccountName, candidate.right.lineAccountName].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-3 text-ink-secondary">{new Date(candidate.reviewedAt ?? candidate.detectedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{candidate.status === 'pending' ? '未確認' : candidate.status === 'linked' ? '確認済み' : candidate.status === 'deferred' ? '保留' : '別人'}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Button href={`/friends/identity-candidates?id=${encodeURIComponent(candidate.id)}`}>重複候補を確認</Button></td>
                  </tr>
                )) : <TableStateRow colSpan={7} kind="empty" title="条件に合う重複候補はありません" />}
              </tbody>
            </table>
            {/*
              #984 LAY-16: 0件のとき「範囲の先頭が末尾を越える表示」を出していた。
              件数が0なら「0組」だけ、検索で0件なら解除の導線を出す。
            */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3 text-xs text-ink-faint">
              {/* FRIEND-12: 応待ちは「更新中」と明示し、前の条件の結果と誤認させない。 */}
              {candidatesLoading ? <span>更新中…</span> : null}
              {candidateError ? (
                <span>{candidateError}</span>
              ) : candidateTotal === 0 && !candidatesLoading ? (
                '0組'
              ) : candidates.length === 0 && !candidatesLoading ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  検索条件に合う候補はありません
                  <button
                    type="button"
                    onClick={() => { setQuery(''); setStatus('') }}
                    className="font-semibold text-action hover:underline"
                  >
                    検索条件を解除する
                  </button>
                </span>
              ) : candidateTotal > 0 ? (
                <span>
                  {fmt.format(candidateTotal)}組中 {fmt.format(rangeStart)}〜{fmt.format(rangeEnd)}組
                </span>
              ) : null}
              {/* FRIEND-11: 51件目以降へ進めるページ送り。 */}
              <Pagination
                page={page}
                pageCount={candidatePageCount}
                onPageChange={setPage}
                disabled={candidatesLoading}
                ariaLabel="重複候補のページ"
              />
            </div>
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-sm font-bold text-[#1D1D1F]">アカウント別ブレイクダウン</h2>
            <p className="mt-1 text-xs text-ink-faint">どのアカウントに重複が偏っているかを見ます。</p>
            {data.perAccount.length === 0 ? (
              <p className="mt-3 text-sm text-[#8B938D]">アカウントが登録されていません。</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-[14px] border border-[#DADDE2] bg-white shadow-card">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <TableHeadRow>
                      <Th>アカウント</Th>
                      <Th align="right">友だち数</Th>
                      <Th align="right">うち重複</Th>
                      <Th align="right">重複率</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-[#EAEBED] bg-white text-[#565F59]">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td className="truncate px-4 py-4 font-semibold text-[#1D1D1F]" title={row.accountName}>{row.accountName}</td>
                        <td className="px-4 py-4 text-right tabular-nums">{fmt.format(row.friends)}</td>
                        <td className="px-4 py-4 text-right tabular-nums">{fmt.format(row.dups)}</td>
                        <td className="px-4 py-4 text-right tabular-nums">
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
            <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
              <h2 className="text-sm font-bold text-[#1D1D1F]">アカウント間 重複マトリックス</h2>
              <p className="mt-1 text-xs text-[#8B938D]">
                行アカウントの友だちのうち、列アカウントにも居る人数 （行のアカウントに対する割合）。
              </p>
              <div className="mt-3 overflow-hidden rounded-[14px] border border-[#DADDE2] bg-white shadow-card">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <TableHeadRow>
                      <Th>行 \ 列</Th>
                      {data.perAccount.map((col) => (
                        <Th
                          key={col.accountId}
                          title={col.accountName}
                          align="right"
                          className="truncate"
                        >
                          {col.accountName}
                        </Th>
                      ))}
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-[#EAEBED] bg-white text-[#565F59]">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td title={row.accountName} className="truncate px-2 py-4 font-semibold text-[#1D1D1F]">
                          {row.accountName}
                        </td>
                        {data.perAccount.map((col) => {
                          if (row.accountId === col.accountId) {
                            return (
                              <td
                                key={col.accountId}
                                className="px-4 py-4 text-right text-[#B8BCC2]"
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
                              className="px-2 py-4 text-right tabular-nums"
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
