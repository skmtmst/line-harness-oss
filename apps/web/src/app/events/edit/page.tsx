'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import EventForm from '@/components/events/event-form'
import { useAccount } from '@/contexts/account-context'
import {
  eventsApi,
  type EventBookingItem,
  type EventDetail,
  type EventSlot,
  type EventWaitlistItem,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * イベントの編集（設計 V2 8-3-1）。
 *
 * 入力そのものは作成のときと同じ EventForm を使う。設計と違うのは、編集の
 * ときだけ「いま何件申し込まれているか」が分かること。定員を減らす前に、
 * 確定している申込がいくつあるかを見られないと判断できない。
 *
 * 申込のときに聞くこと（設計の3節）は入れていない。イベントに項目を持たせる
 * 場所が無く、回答フォームとは別に持つかどうかも決まっていない。
 */

function BookingStatus({ accountId, eventId }: { accountId: string; eventId: string }) {
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [slots, setSlots] = useState<EventSlot[]>([])
  const [bookings, setBookings] = useState<EventBookingItem[]>([])
  const [waitlist, setWaitlist] = useState<EventWaitlistItem[]>([])
  const [loading, setLoading] = useState(true)
  // どれか落ちても残りは出すが、黙って0件表示にしない。全部落ちたら
  // 枠が0件に見え、申込なしと読み違えて定員判断を誤る(点検#520の中10)。
  const [loadError, setLoadError] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    void (async () => {
      // どれか落ちても残りは出す。数えられなかったものは「—」になる。
      const [e, s, b, w] = await Promise.allSettled([
        eventsApi.getEvent(accountId, eventId),
        eventsApi.listSlots(accountId, eventId),
        eventsApi.listBookings(accountId, eventId),
        eventsApi.listWaitlist(accountId, eventId),
      ])
      if (cancelled) return
      if (e.status === 'fulfilled') setEvent(e.value)
      if (s.status === 'fulfilled') setSlots(s.value.items)
      if (b.status === 'fulfilled') setBookings(b.value.items)
      if (w.status === 'fulfilled') setWaitlist(w.value.waitlist)
      if ([e, s, b, w].some((r) => r.status === 'rejected')) setLoadError(true)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [accountId, eventId, reloadSeq])

  const count = (status: string) => bookings.filter((x) => x.status === status).length
  /** 枠の定員の合計。定員なしの枠が混ざっていたら合計は出さない。 */
  const capacity = slots.some((s) => s.capacity == null)
    ? null
    : slots.reduce((sum, s) => sum + (s.capacity ?? 0), 0)

  const cells: Array<[string, string]> = [
    ['予約 / 定員', `${count('confirmed')} / ${capacity ?? '—'}`],
    // 承認待ちは requested。confirmed になるまで枠は確保されない。
    ['承認待ち', `${count('requested')} 件`],
    ['キャンセル待ち', `${waitlist.length} 件`],
    ['キャンセル', `${count('cancelled')} 件`],
  ]

  return (
    <div data-design="Status" className="mb-5">
      {loadError && (
        <p className="bg-warning-bg border-warning text-warning mb-3 rounded-control border px-4 py-3 text-xs" role="alert">
          一部を取得できませんでした。数は実際より少なく見えます。
          <button className="ml-2 font-semibold underline" onClick={() => { setLoading(true); setReloadSeq((n) => n + 1) }}>読み直す</button>
        </p>
      )}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-ink text-sm font-bold">申込の状況</h2>
        {event && (
          <span
            className={`rounded-pill px-2 py-0.5 text-[10px] font-medium ${
              event.is_published
                ? 'bg-success-bg text-success'
                : 'bg-canvas-sunken text-ink-faint'
            }`}
          >
            {event.is_published ? '受付中' : '下書き'}
          </span>
        )}
        <Link
          href={`/events/bookings?id=${eventId}`}
          className="text-accent ml-auto text-xs hover:underline"
        >
          予約者を見る
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label} className="bg-canvas rounded-card border-hairline border p-3">
            <p className="text-ink-faint text-xs">{label}</p>
            <p className="text-ink mt-0.5 text-xl font-bold tabular-nums">
              {loading ? '…' : value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function EditEventInner() {
  const params = useSearchParams()
  const id = params.get('id')
  const { selectedAccountId } = useAccount()

  if (!id) {
    return (
      <div>

        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          イベントが指定されていません。
          <Link href="/events" className="text-accent ml-1 hover:underline">
            イベント予約へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs" data-design="Crumb" aria-label="パンくず">
          <Link href="/events" className="hover:underline">
            イベント予約
          </Link>
          <span className="mx-1.5">/</span>
          <span>編集</span>
        </nav>
        <Link
          href={`/events/bookings?id=${id}`}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
        >
          申込の一覧を見る
        </Link>
      </div>

      {!selectedAccountId ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          アカウントを選択してください。
        </p>
      ) : (
        <>
          <BookingStatus accountId={selectedAccountId} eventId={id} />
          <div data-design="Body">
            <EventForm accountId={selectedAccountId} eventId={id} />
          </div>

          <section className="bg-canvas-sunken rounded-card border-hairline mt-5 border p-4">
            <h2 className="text-ink text-sm font-bold">気をつけること</h2>
            <ul className="text-ink-faint mt-2 space-y-1 text-xs leading-relaxed">
              <li>・承認制にすると、承認するまで枠は確保されません</li>
              <li>・定員に達するとキャンセル待ちに切り替わります</li>
              <li>
                ・公開後に定員を減らすことはできますが、すでに確定した申込は取り消されません
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

export default function EditEventPage() {
  usePageTitle('イベントの編集')
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <EditEventInner />
    </Suspense>
  )
}
