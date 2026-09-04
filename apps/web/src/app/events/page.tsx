'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { eventsApi, type EventListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

/**
 * イベント予約（設計 V2 8-3 / node Ih3xS）。
 *
 * 以前は札を並べた形で、見出しが二重（Header と h1）に出ていた。
 * 札だと「どのイベントに承認待ちが溜まっているか」を見比べにくい。
 * 設計どおり、KPI4枚と表にした。
 */

/** 1ページに出す件数。設計の「表示 20件」に合わせる。 */
const PAGE_SIZE = 20

function formatJpDate(iso: string | null): string {
  if (!iso) return '日時未設定'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export default function EventsListPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<EventListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'open' | 'pending' | 'full'>('all')
  const [page, setPage] = useState(1)

  const refresh = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    try {
      const res = await eventsApi.listEvents(selectedAccountId)
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setPage(1)
  }, [query, filter])

  function isFull(e: EventListItem): boolean {
    return e.total_capacity != null && e.total_active >= e.total_capacity
  }

  const kpi = useMemo(() => {
    const open = items.filter((e) => e.is_published === 1)
    const applied = items.reduce((sum, e) => sum + e.total_active, 0)
    const capacity = open.reduce((sum, e) => sum + (e.total_capacity ?? 0), 0)
    const filled = open.reduce((sum, e) => sum + e.total_active, 0)
    return {
      open: open.length,
      applied,
      // 受付中のイベントで、定員のうちどれだけ埋まったか。
      // 定員なしのイベントは分母に入れられないので、混ぜずに省く。
      rate: capacity > 0 ? Math.round((filled / capacity) * 100) : null,
      pending: items.reduce((sum, e) => sum + e.pending_count, 0),
    }
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim()
    return items.filter((e) => {
      if (q && !e.name.includes(q)) return false
      if (filter === 'open' && e.is_published !== 1) return false
      if (filter === 'pending' && e.pending_count === 0) return false
      if (filter === 'full' && !isFull(e)) return false
      return true
    })
  }, [items, query, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <div>
      <div data-design="Head">
        <Header
          title="イベント予約"
          description="開催するイベントの申込を管理します。定員と承認制の設定ができます。"
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            disabled
            title="操作マニュアルは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            マニュアル
          </button>
          <button
            disabled
            title="並び替えは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            並び替え
          </button>
          <button
            disabled
            title="フォルダ分けは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            フォルダを追加
          </button>
          <Link
            href="/events/new"
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium"
          >
            イベントを作成
          </Link>
        </div>
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="イベント"
          value={String(items.length)}
          unit="件"
          detail={`受付中 ${kpi.open}`}
        />
        <Kpi title="申込" value={String(kpi.applied)} unit="人" detail="累計" />
        <Kpi
          title="定員の充足"
          value={kpi.rate === null ? '—' : String(kpi.rate)}
          unit="%"
          detail="受付中のもの"
        />
        <Kpi title="承認待ち" value={String(kpi.pending)} unit="件" detail="要対応" />
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-3 text-sm">
          {error}
        </div>
      )}

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="イベント名で検索"
          aria-label="イベント名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <select
          disabled
          title="並び替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>開催日が近い順</option>
        </select>
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <select
          disabled
          title="表示件数の切り替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>20件</option>
        </select>
        <button
          disabled
          title="保存した条件は準備中です"
          className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
        >
          保存した条件
        </button>
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs">よく使う</span>
        {(
          [
            ['open', '受付中のみ'],
            ['pending', '承認待ちあり'],
            ['full', '満席'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
            className={`rounded-pill px-3 py-1 text-xs font-medium ${
              filter === key
                ? 'bg-accent-deep text-on-accent'
                : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!selectedAccountId ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          サイドバーでアカウントを選択してください
        </div>
      ) : loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          読み込み中...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
          <p className="text-ink mb-2 font-medium">イベントがまだありません</p>
          <p className="text-ink-faint mb-4 text-sm">
            友だちに告知する勉強会・説明会・オフ会などをここから作成します。
          </p>
          <Link
            href="/events/new"
            className="bg-accent-deep text-on-accent rounded-control inline-block px-4 py-2 text-sm font-medium"
          >
            最初のイベントを作成
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          条件に合うイベントはありません
        </div>
      ) : (
        <div
          data-design="Table"
          className="bg-canvas rounded-card border-hairline overflow-hidden border"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-canvas-sunken border-hairline border-b">
                  <Th>イベント名</Th>
                  <Th>開催日時</Th>
                  <Th className="text-right">予約 / 定員</Th>
                  <Th className="text-right">承認待ち</Th>
                  <Th>申込条件</Th>
                  <Th>状態</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((e) => (
                  <tr key={e.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/events/edit?id=${e.id}`}
                        className="text-ink font-medium hover:underline"
                      >
                        {e.name}
                      </Link>
                      {e.venue_name && (
                        <span className="text-ink-faint block text-xs">{e.venue_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap tabular-nums">
                      {formatJpDate(e.next_slot_starts_at)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {e.total_active}
                      <span className="text-ink-faint">
                        {' / '}
                        {e.total_capacity ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {e.pending_count > 0 ? (
                        <Link
                          href={`/events/bookings?id=${e.id}`}
                          className="text-warning font-medium hover:underline"
                        >
                          {e.pending_count} 件
                        </Link>
                      ) : (
                        <span className="text-ink-faint">0 件</span>
                      )}
                    </td>
                    {/* 申込条件。visible_tag_id が入っていると、そのタグの人にしか
                        LIFF の一覧に出ない。「全員」と見分けがつかないと、公開した
                        つもりで誰にも見えていない状態に気づけない。
                        タグを消しても events 側の ID は残るので、その場合は名前が
                        引けない＝もう誰にも見えない、と分かるように別の文言を出す。 */}
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {!e.visible_tag_id ? (
                        '全員'
                      ) : e.visible_tag_name ? (
                        e.visible_tag_name
                      ) : (
                        <span className="text-warning">消えたタグ</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {e.is_published !== 1 ? (
                        <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs">
                          準備中
                        </span>
                      ) : isFull(e) ? (
                        <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs">
                          満席
                        </span>
                      ) : (
                        <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs">
                          受付中
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-faint text-xs">全 {filtered.length} 件</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={current <= 1}
            className="border-hairline rounded-control border px-3 py-1 text-xs disabled:opacity-40"
          >
            前へ
          </button>
          <span className="text-ink-secondary px-2 text-xs tabular-nums">
            {current} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={current >= pageCount}
            className="border-hairline rounded-control border px-3 py-1 text-xs disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-ink-faint px-4 py-3 text-left text-xs font-semibold ${className}`}>
      {children}
    </th>
  )
}

function Kpi({
  title,
  value,
  unit,
  detail,
}: {
  title: string
  value: string
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{title}</p>
      <p className="text-ink mt-1 text-2xl font-semibold tabular-nums">
        {value}
        <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>
      </p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}
