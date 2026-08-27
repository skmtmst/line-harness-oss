'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { eventsApi, type EventListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'

/**
 * イベント予約（設計 V2 8-3 / node Ih3xS）。
 *
 * 以前は札を並べた形で、見出しが二重（Header と h1）に出ていた。
 * 札だと「どのイベントに承認待ちが溜まっているか」を見比べにくい。
 * 設計どおり、KPI4枚と表にした。
 */

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
  const [sort, setSort] = useState<'date' | 'applications' | 'name'>('date')
  const [pageSize, setPageSize] = useState(20)
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
  }, [query, filter, sort, pageSize])

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
    const visible = items.filter((e) => {
      if (q && !e.name.includes(q)) return false
      if (filter === 'open' && e.is_published !== 1) return false
      if (filter === 'pending' && e.pending_count === 0) return false
      if (filter === 'full' && !isFull(e)) return false
      return true
    })
    return visible.sort((a, b) => {
      if (sort === 'applications') return b.total_active - a.total_active
      if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
      const aDate = a.next_slot_starts_at ? Date.parse(a.next_slot_starts_at) : Number.MAX_SAFE_INTEGER
      const bDate = b.next_slot_starts_at ? Date.parse(b.next_slot_starts_at) : Number.MAX_SAFE_INTEGER
      return aDate - bDate
    })
  }, [items, query, filter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize)

  return (
    <div data-design-node="ugP5y">
      <div className="mb-4 flex items-center">
        <Button href="/events/new" variant="primary">
          イベントを作る
        </Button>
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
        <Select
          aria-label="イベントの並び順"
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={[
            { value: 'date', label: '開催日が近い順' },
            { value: 'applications', label: '申込が多い順' },
            { value: 'name', label: 'イベント名順' },
          ]}
        />
        <Select
          aria-label="表示件数"
          size="page-size"
          value={String(pageSize)}
          onChange={(value) => setPageSize(Number(value))}
          options={[10, 20, 50].map((value) => ({ value: String(value), label: `${value}件表示` }))}
        />
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
                ? 'bg-accent text-on-accent'
                : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div data-design-node="k5m5Bc">
      {!selectedAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="サイドバーで運用するLINEアカウントを選んでください。" />
      ) : loading ? (
        <ListState kind="loading" />
      ) : error ? (
        <ListState kind="error" description={error} action={<Button onClick={() => void refresh()}>再読み込み</Button>} />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title="イベントがまだありません"
          description="友だちに告知する勉強会・説明会・オフ会などをここから作成します。"
          action={<Button href="/events/new" variant="primary">イベントを作る</Button>}
        />
      ) : shown.length === 0 ? (
        <ListState kind="empty" title="条件に合うイベントはありません" description="検索語や絞り込み条件を変えてください。" />
      ) : (
        <div
          data-design="Table"
          className="bg-canvas rounded-card border-hairline overflow-hidden border"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <TableHeadRow>
                  <Th>イベント名</Th>
                  <Th>開催日時</Th>
                  <Th align="right">予約 / 定員</Th>
                  <Th align="right">承認待ち</Th>
                  <Th>申込条件</Th>
                  <Th>状態</Th>
                </TableHeadRow>
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
                          下書き
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
      </div>

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-faint text-xs">
          {filtered.length === 0 ? '0件' : `${(current - 1) * pageSize + 1}〜${Math.min(current * pageSize, filtered.length)}件 / 全${filtered.length}件`}
        </span>
        <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />
      </div>
    </div>
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
