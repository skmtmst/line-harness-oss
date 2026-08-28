'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import {
  eventsApi,
  type EventBookingItem,
  type EventDetail,
  type EventWaitlistItem,
} from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'

type LoadStatus = 'loading' | 'ready' | 'error'

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '承認待ち' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'expired', label: '期限切れ' },
  { key: 'attended', label: '参加済' },
  { key: 'no_show', label: '無断' },
  { key: 'waitlist', label: 'キャンセル待ち' },
  { key: 'all', label: '全件' },
]

const statusBadge: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-600',
  expired: 'bg-gray-100 text-gray-500',
  attended: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function BookingsInner() {
  const params = useSearchParams()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [waitlist, setWaitlist] = useState<EventWaitlistItem[]>([])
  const [totalCapacity, setTotalCapacity] = useState<number | null>(null)
  const [capacityLoadStatus, setCapacityLoadStatus] = useState<LoadStatus>('loading')
  const [tab, setTab] = useState<string>('requested')
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const loadRequestRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId || !eventId) {
      setEvent(null)
      setItems([])
      setWaitlist([])
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    setActionError(null)
    setEvent(null)
    setItems([])
    setWaitlist([])
    try {
      const [evRes, listRes, waitlistRes] = await Promise.all([
        eventsApi.getEvent(selectedAccountId, eventId),
        eventsApi.listBookings(selectedAccountId, eventId),
        eventsApi.listWaitlist(selectedAccountId, eventId),
      ])
      if (requestId !== loadRequestRef.current) return
      setEvent(evRes)
      setItems(listRes.items)
      setWaitlist(waitlistRes.waitlist)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      setEvent(null)
      setItems([])
      setWaitlist([])
      setLoadStatus('error')
    }
  }, [selectedAccountId, eventId])

  useEffect(() => {
    void refresh()
    return () => {
      loadRequestRef.current += 1
    }
  }, [refresh])

  // 枠の合計＝定員。一覧APIからしか取れない。
  useEffect(() => {
    setTotalCapacity(null)
    if (!selectedAccountId || !eventId) {
      setCapacityLoadStatus('ready')
      return
    }
    setCapacityLoadStatus('loading')
    let alive = true
    eventsApi
      .listEvents(selectedAccountId)
      .then((r) => {
        if (!alive) return
        setTotalCapacity(r.items.find((x) => x.id === eventId)?.total_capacity ?? null)
        setCapacityLoadStatus('ready')
      })
      .catch(() => {
        if (!alive) return
        setTotalCapacity(null)
        setCapacityLoadStatus('error')
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId, eventId])

  if (!eventId) {
    return <div className="p-4 text-red-700">id クエリが必要です</div>
  }

  async function decide(id: string, action: 'confirm' | 'reject') {
    if (!selectedAccountId || !eventId) return
    let reason: string | undefined
    if (action === 'reject') {
      const r = window.prompt('拒否理由（任意・admin内部メモ。友だちには固定文面）')
      if (r === null) return
      reason = r || undefined
    }
    setBusy(true)
    try {
      await eventsApi.decideBooking(selectedAccountId, eventId, id, action, reason)
      await refresh()
    } catch {
      setActionError('予約を確定・拒否できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function adminCancel(id: string) {
    if (!selectedAccountId || !eventId) return
    if (!confirm('運営側でキャンセルしますか？友だちにLINE通知が送られます。')) return
    setBusy(true)
    try {
      await eventsApi.adminCancelBooking(selectedAccountId, eventId, id)
      await refresh()
    } catch {
      setActionError('予約をキャンセルできませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function markStatus(id: string, status: 'attended' | 'no_show') {
    if (!selectedAccountId || !eventId) return
    setBusy(true)
    try {
      await eventsApi.updateBooking(selectedAccountId, eventId, id, { status })
      await refresh()
    } catch {
      setActionError('来場状態を変更できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const confirmed = items.filter((b) => b.status === 'confirmed').length
  const pending = items.filter((b) => b.status === 'requested').length
  const cancelled = items.filter((b) => b.status === 'cancelled').length
  // 定員は一覧APIが持っている（枠の合計）。詳細APIには入っていない。
  const capacity = totalCapacity ?? 0
  const shownItems = tab === 'all' ? items : items.filter((item) => item.status === tab)
  const dataReady = loadStatus === 'ready'

  function csvCell(value: unknown): string {
    const raw = String(value ?? '')
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
    return `"${safe.replaceAll('"', '""')}"`
  }

  function downloadCsv() {
    const rows = tab === 'waitlist'
      ? [
          ['順番', '友だち', '予約枠', '状態', '受付日時'],
          ...waitlist.map((item, index) => [
            index + 1,
            item.friend_name ?? item.friend_id.slice(0, 8),
            formatJp(item.slot_starts_at),
            item.status === 'invited' ? '案内済み' : '待機中',
            formatJp(item.created_at),
          ]),
        ]
      : [
          ['友だち', '経由アカウント', '予約枠', '状態', '受付日時'],
          ...shownItems.map((item) => [
            item.friend_display_name ?? item.friend_id.slice(0, 8),
            accounts.find((account) => account.id === item.line_account_id)?.name ?? '',
            formatJp(item.slot_starts_at),
            STATUS_TABS.find((status) => status.key === item.status)?.label ?? item.status,
            formatJp(item.requested_at),
          ]),
        ]
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `event-${eventId}-${tab}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-design-node="i5SN2j">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/events" className="hover:underline">
          イベント予約
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/events/edit?id=${eventId}`} className="hover:underline">
          {event?.name ?? '編集'}
        </Link>
        <span className="mx-1.5">/</span>
        <span>予約者</span>
      </nav>

      <div data-design="Head" className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={downloadCsv} disabled={!dataReady}>CSVで書き出す</Button>
      </div>

      <div data-design="Sel" className="bg-canvas rounded-card border-hairline mb-4 border p-3">
        <span className="text-ink-faint mr-2 text-xs">イベント</span>
        <span className="text-ink text-sm font-medium">{event?.name ?? (loadStatus === 'loading' ? '読み込み中…' : '—')}</span>
        <Link href="/events" className="text-accent ml-3 text-xs hover:underline">
          ほかのイベントを選ぶ
        </Link>
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <EventKpi
          title="申込"
          value={dataReady ? String(confirmed + pending) : '—'}
          unit={dataReady ? '人' : ''}
          detail={dataReady
            ? capacityLoadStatus === 'loading'
              ? '定員を確認しています'
              : capacityLoadStatus === 'error'
                ? '定員は取得できませんでした'
                : capacity > 0
                  ? `定員 ${capacity} ・ 残り${Math.max(0, capacity - confirmed)}`
                  : '定員なし'
            : '取得できませんでした'}
        />
        <EventKpi title="承認待ち" value={dataReady ? String(pending) : '—'} unit={dataReady ? '件' : ''} detail={dataReady ? '対応が必要' : '取得できませんでした'} />
        <EventKpi
          title="キャンセル待ち"
          value={dataReady ? String(waitlist.length) : '—'}
          unit={dataReady ? '人' : ''}
          detail={dataReady ? (event?.waitlist_enabled ? '空きが出たら順に案内' : '受け付けない設定です') : '取得できませんでした'}
        />
        <EventKpi title="キャンセル" value={dataReady ? String(cancelled) : '—'} unit={dataReady ? '件' : ''} detail={dataReady ? 'この一覧のうち' : '取得できませんでした'} />
      </div>

      {actionError ? (
        <div className="bg-danger-bg text-danger rounded-card mb-4 border border-danger/20 px-4 py-3 text-sm" role="alert">
          {actionError}
        </div>
      ) : null}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loadStatus === 'loading' ? (
            <ListState kind="loading" />
          ) : loadStatus === 'error' ? (
            <ListState kind="error" description="申込者とキャンセル待ちを読み込めませんでした。登録内容は消えていません。" action={<Button onClick={() => void refresh()}>申込者を再読み込み</Button>} />
          ) : tab === 'waitlist' ? (
            waitlist.length === 0 ? (
              <ListState kind="empty" title="キャンセル待ちはありません" description="空き待ちの友だちはまだいません。" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <TableHeadRow>
                      <Th>順番</Th>
                      <Th>友だち</Th>
                      <Th>予約枠</Th>
                      <Th>状態</Th>
                      <Th>受付日時</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {waitlist.map((item, index) => (
                      <tr key={item.id} className="border-t border-gray-100">
                        <td className="px-4 py-3 tabular-nums">{index + 1}</td>
                        <td className="px-4 py-3">{item.friend_name ?? item.friend_id.slice(0, 8)}</td>
                        <td className="px-4 py-3">{formatJp(item.slot_starts_at)}</td>
                        <td className="px-4 py-3">{item.status === 'invited' ? '案内済み' : '待機中'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{formatJp(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : shownItems.length === 0 ? (
            <ListState kind="empty" title="該当する予約はありません" description="状態を変えると、ほかの予約を確認できます。" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <TableHeadRow>
                    <Th>友だち</Th>
                    <Th>経由アカ</Th>
                    <Th>予約枠</Th>
                    <Th>状態</Th>
                    <Th>受付日時</Th>
                    <Th align="right">操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {shownItems.map((b) => {
                    const acct = accounts.find((a) => a.id === b.line_account_id)
                    const accountLabel = acct
                      ? `${acct.country ? acct.country + ' ' : ''}${acct.name}`
                      : (b.line_account_id ?? '').slice(0, 8)
                    return (
                    <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">
                        {b.friend_display_name ?? b.friend_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{accountLabel}</td>
                      <td className="px-4 py-3 text-gray-700">{formatJp(b.slot_starts_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[b.status] ?? 'bg-gray-100'}`}>
                          {STATUS_TABS.find((t) => t.key === b.status)?.label ?? b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatJp(b.requested_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {b.status === 'requested' && (
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={() => decide(b.id, 'confirm')}
                              disabled={busy}
                              className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                            >
                              承認
                            </button>
                            <button
                              onClick={() => decide(b.id, 'reject')}
                              disabled={busy}
                              className="px-3 py-1 bg-gray-500 text-white rounded-lg text-xs font-medium hover:bg-gray-600 disabled:opacity-50"
                            >
                              拒否
                            </button>
                          </div>
                        )}
                        {b.status === 'confirmed' && (
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={() => markStatus(b.id, 'attended')}
                              disabled={busy}
                              className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              参加済
                            </button>
                            <button
                              onClick={() => markStatus(b.id, 'no_show')}
                              disabled={busy}
                              className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 disabled:opacity-50"
                            >
                              無断
                            </button>
                            <button
                              onClick={() => adminCancel(b.id)}
                              disabled={busy}
                              className="px-3 py-1 border border-gray-300 rounded-lg text-xs font-medium hover:bg-white disabled:opacity-50"
                            >
                              キャンセル
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
    </div>
  )
}

/** KPIの札。予約まわりの他画面と同じ形にそろえる。 */
function EventKpi({
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

export default function EventBookingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">読み込み中...</div>}>
      <BookingsInner />
    </Suspense>
  )
}
