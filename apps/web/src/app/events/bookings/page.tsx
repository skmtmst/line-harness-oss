'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { eventsApi, type EventBookingItem, type EventDetail } from '@/lib/api'

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '承認待ち' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'expired', label: '期限切れ' },
  { key: 'attended', label: '参加済' },
  { key: 'no_show', label: '無断' },
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
  })
}

function BookingsInner() {
  const params = useSearchParams()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [totalCapacity, setTotalCapacity] = useState<number | null>(null)
  const [capacityStatus, setCapacityStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tab, setTab] = useState<string>('requested')
  /*
   * **読めなかったのか、0件なのかを分ける。**
   *
   * 前は `loading` の真偽だけで、失敗しても帯が「申込 0人・承認待ち 0件」、
   * 表が「該当する予約はありません」になった。**予約が入っていないのか、
   * 取れなかっただけなのかを画面から区別できない。** 承認待ちを見落とす。
   */
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  /** 切り替え前の遅い応答を、次のイベント・次の絞り込みの一覧へ混ぜない。 */
  const loadRequestRef = useRef(0)
  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らない。運営キャンセルは友だちへLINEが飛ぶ操作なので、
   * 誰の予約なのか・何が起きるのかを本文で読ませたい。
   *
   * `accountId` は**押した時点で選んでいたLINEアカウント**。この画面は
   * ヘッダーで切り替えられるので、切り替わったら実行させずに選び直させる。
   */
  const [cancelTarget, setCancelTarget] = useState<
    { booking: EventBookingItem; accountId: string } | null
  >(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const accountChanged = cancelTarget !== null && cancelTarget.accountId !== selectedAccountId
  const dataReady = loadStatus === 'ready'

  const refresh = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setActionError(null)
    try {
      const filters = tab === 'all' ? {} : { status: tab }
      /*
        **前のイベントの控えを使い回さない。** `event` が入っていれば取りに
        行かない作りだったので、アカウントやイベントを切り替えたあとも
        **上の帯に前のイベント名と定員が残った。** どのイベントの
        申込を見ているのか読み違える。毎回取り直す。
      */
      const [evRes, listRes] = await Promise.all([
        eventsApi.getEvent(selectedAccountId, eventId),
        eventsApi.listBookings(selectedAccountId, eventId, filters),
      ])
      if (requestId !== loadRequestRef.current) return
      setEvent(evRes)
      setItems(listRes.items)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      /*
        **数を持ち越さない。** 前の絞り込みの行を残したまま失敗を出すと、
        古い数の上に「取れませんでした」が乗って、どちらが本当か読めない。
      */
      setEvent(null)
      setItems([])
      setLoadStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, eventId, tab])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
    枠の合計＝定員。一覧APIからしか取れない。

    **「定員なし」と「定員を取れなかった」を分ける。** 前は失敗しても
    `totalCapacity` が null のままで「定員なし」と出た。**上限が無いのか、
    読めなかったのかが分からず、締め切りの判断を誤る。**
  */
  useEffect(() => {
    if (!selectedAccountId || !eventId) return
    let alive = true
    setCapacityStatus('loading')
    setTotalCapacity(null)
    eventsApi
      .listEvents(selectedAccountId)
      .then((r) => {
        if (!alive) return
        setTotalCapacity(r.items.find((x) => x.id === eventId)?.total_capacity ?? null)
        setCapacityStatus('ready')
      })
      .catch(() => {
        // 定員が出ないだけ。一覧と操作はできる。
        if (alive) setCapacityStatus('error')
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
      /*
        **内部の文字をそのまま出さない。** `e.message` は
        `API error: 409` のような形で出る。何を直せばよいか分からない。
      */
      setActionError('予約を確定・拒否できませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 運営側キャンセルを実際に投げる。
   *
   * 処理中は受け付けない（二度押しすると2回目は「その状態からは変えられない」
   * で弾かれ、通知だけ済んでいるのに失敗に見える）。失敗は握りつぶさず、
   * 窓の中に運用者の言葉で出す。生のAPIエラー（`invalid_state` など）は
   * 運用者が次に何をすればよいか読み取れない。
   */
  async function runAdminCancel() {
    if (!cancelTarget || !eventId || cancelling || accountChanged) return
    setCancelling(true)
    setCancelError('')
    setBusy(true)
    try {
      const res = await eventsApi.adminCancelBooking(
        cancelTarget.accountId,
        eventId,
        cancelTarget.booking.id,
      )
      if (!res?.ok) throw new Error('cancel_not_applied')
      setCancelTarget(null)
      await refresh()
    } catch {
      setCancelError(
        'この予約をキャンセルできませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。',
      )
    } finally {
      setCancelling(false)
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
      setActionError('来場・不参加の記録を変えられませんでした。一覧を読み直してから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const confirmed = items.filter((b) => b.status === 'confirmed').length
  const pending = items.filter((b) => b.status === 'requested').length
  const cancelled = items.filter((b) => b.status === 'cancelled').length
  // 定員は一覧APIが持っている（枠の合計）。詳細APIには入っていない。
  const capacity = totalCapacity ?? 0

  return (
    <div>
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

      <div data-design="Head">
        <Header
          title="イベントの予約者"
          description="申込の確認・承認・キャンセルを行います。承認制のイベントは、承認するまで確定しません。"
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
            title="書き出しは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            CSVで書き出す
          </button>
          {/* 予約者だけに送る仕組みが無い。一斉配信はいまのところ
              タグや友だち全体が単位で、イベントの申込者を宛先にできない。 */}
          <button
            disabled
            title="予約者だけを宛先にする配信は準備中です"
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium opacity-50"
          >
            予約者に一斉送信
          </button>
        </div>
      </div>

      <div data-design="Sel" className="bg-canvas rounded-card border-hairline mb-4 border p-3">
        <span className="text-ink-faint mr-2 text-xs">イベント</span>
        {/*
          **読めなかったのを「読み込み中」と言わない。** いつまでも
          読み込んでいるように見え、再読み込みに気づけない。
        */}
        <span className="text-ink text-sm font-medium">
          {event?.name ?? (loadStatus === 'error' ? 'イベント名を取得できませんでした' : '読み込み中…')}
        </span>
        <Link href="/events" className="text-accent ml-3 text-xs hover:underline">
          ほかのイベントを選ぶ
        </Link>
      </div>

      {/*
        **取れていないときは 0 を出さない。** 「承認待ち 0件」は
        「対応するものが無い」と読める。取れていないだけなら、
        待たせている人を見落とす。
      */}
      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <EventKpi
          title="申込"
          value={dataReady ? String(confirmed + pending) : '—'}
          unit={dataReady ? '人' : ''}
          detail={!dataReady
            ? '取得できませんでした'
            : capacityStatus === 'error'
              ? '定員は取得できませんでした'
              : capacity > 0
                ? `定員 ${capacity} ・ 残り${Math.max(0, capacity - confirmed)}`
                : '定員なし'}
        />
        <EventKpi title="承認待ち" value={dataReady ? String(pending) : '—'} unit={dataReady ? '件' : ''} detail={dataReady ? '対応が必要' : '取得できませんでした'} />
        {/* event_bookings に「キャンセル待ち」という状態が無い。
            イベント側に waitlist_enabled はあるが、待っている人を数える
            場所がまだない。数を作らずに、受けるかどうかだけ出す。 */}
        <EventKpi
          title="キャンセル待ち"
          value="—"
          unit={dataReady ? '人' : ''}
          /*
            **読めていない設定を言い切らない。** `event` が取れていないと
            `waitlist_enabled` は undefined で、前は必ず「受け付けない設定です」
            と出ていた。**受け付ける設定なのに受け付けないと読める。**
          */
          detail={!dataReady
            ? '取得できませんでした'
            : event?.waitlist_enabled ? '空きが出たら順に案内' : '受け付けない設定です'}
        />
        <EventKpi title="キャンセル" value={dataReady ? String(cancelled) : '—'} unit={dataReady ? '件' : ''} detail={dataReady ? 'この一覧のうち' : '取得できませんでした'} />
      </div>


        {/*
          操作の失敗は**一覧を消さずに**上に出す。行が消えると、
          どの予約に対して失敗したのかが分からなくなる。
        */}
        {actionError && (
          <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-3 text-sm">
            {actionError}
          </div>
        )}

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
            /*
              **0件と同じ文にしない。** 「該当する予約はありません」だと、
              予約を消してしまったのかと読める。消えていないことを先に言う。
            */
            <ListState
              kind="error"
              description="受け付けた予約は消えていません。再読み込みしても直らない場合はエラー報告へ。"
              action={<Button onClick={() => void refresh()}>予約を再読み込み</Button>}
            />
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              該当する予約はありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">友だち</th>
                    <th className="text-left px-4 py-2 font-medium">経由アカウント</th>
                    <th className="text-left px-4 py-2 font-medium">予約枠</th>
                    <th className="text-left px-4 py-2 font-medium">状態</th>
                    <th className="text-left px-4 py-2 font-medium">受付日時</th>
                    <th className="text-right px-4 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => {
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
                              onClick={() => {
                                if (!selectedAccountId) return
                                setCancelError('')
                                setCancelTarget({ booking: b, accountId: selectedAccountId })
                              }}
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

      <ConfirmDialog
        open={cancelTarget !== null}
        title="この予約を運営側でキャンセルしますか？"
        description="予約は「キャンセル」になり、枠が空きます。友だちにはLINEでキャンセルのお知らせが届きます。送ったお知らせは取り消せません。この画面から元の「確定」に戻すことはできません。"
        confirmLabel="キャンセルにする"
        cancelLabel="やめる"
        /* 通知が飛び、この画面からは戻せない。だから赤にする。 */
        destructive
        busy={cancelling}
        error={cancelError}
        onConfirm={accountChanged ? undefined : () => void runAdminCancel()}
        onCancel={() => {
          if (cancelling) return
          setCancelTarget(null)
          setCancelError('')
        }}
      >
        {cancelTarget && (
          <div className="text-ink-secondary space-y-2 text-sm">
            <p>
              友だち：
              {cancelTarget.booking.friend_display_name ?? cancelTarget.booking.friend_id.slice(0, 8)}
            </p>
            <p>予約枠：{formatJp(cancelTarget.booking.slot_starts_at)}</p>
            <p className="text-ink-faint text-xs">
              この予約に紐づくリマインダの送信予定も止まります。すでに送ったぶんは残ります。
            </p>
            {accountChanged && (
              <p className="text-warning font-medium">
                押したあとにLINEアカウントが切り替わりました。この窓を閉じて、いまのアカウントの一覧から選び直してください。
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
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
