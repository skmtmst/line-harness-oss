'use client'

import { PageHeading } from '@/components/templates/page-frame'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import EventForm from '@/components/events/event-form'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import { useAccount } from '@/contexts/account-context'
import {
  eventsApi,
  type EventBookingSummary,
  type EventDetail,
  type EventLifecycleStatus,
  type EventSlot,
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

function BookingStatus({ accountId, eventId, refreshKey = 0 }: { accountId: string; eventId: string; refreshKey?: number }) {
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [summary, setSummary] = useState<EventBookingSummary | null>(null)
  // R81: 公開済みでも今後の枠が無ければ「終了」と出すための枠一覧。
  const [slots, setSlots] = useState<EventSlot[] | null>(null)
  const [loading, setLoading] = useState(true)
  // どれか落ちても残りは出すが、黙って0件表示にしない。全部落ちたら
  // 枠が0件に見え、申込なしと読み違えて定員判断を誤る(点検#520の中10)。
  const [loadError, setLoadError] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setEvent(null)
    setSummary(null)
    setSlots(null)
    void (async () => {
      // どれか落ちても残りは出す。数えられなかったものは「—」になる。
      const [e, s, sl] = await Promise.allSettled([
        eventsApi.getEvent(accountId, eventId),
        eventsApi.getBookingSummary(accountId, eventId),
        eventsApi.listSlots(accountId, eventId),
      ])
      if (cancelled) return
      if (e.status === 'fulfilled') setEvent(e.value)
      if (s.status === 'fulfilled') setSummary(s.value)
      if (sl.status === 'fulfilled') setSlots(sl.value.items)
      if ([e, s, sl].some((r) => r.status === 'rejected')) setLoadError(true)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // WEB319：公開の状態を変えたら（refreshKey）、隣の札も読み直す。
  }, [accountId, eventId, reloadSeq, refreshKey])

  const cells: Array<[string, string]> = [
    ['予約 / 定員', `${summary?.confirmed ?? '—'} / ${summary?.totalCapacity ?? '—'}`],
    // 承認待ちは requested。未確定だが席は申請時点から消費している
    // （EVENT-06。残席計算は requested+confirmed を数える）。
    ['承認待ち', `${summary?.requested ?? '—'} 件`],
    ['キャンセル待ち', `${summary?.waitlist ?? '—'} 件`],
    ['キャンセル', `${summary?.cancelled ?? '—'} 件`],
  ]

  return (
    <div data-design="Status" className="mb-5">
      {loadError && (
        <Notice
          tone="warn"
          message="一部を取得できませんでした。取得できなかった数は「—」で表示しています。"
          action={<button className="font-semibold underline" onClick={() => { setLoading(true); setReloadSeq((n) => n + 1) }}>読み直す</button>}
          className="mb-3"
        />
      )}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-ink text-sm font-bold">申込の状況</h2>
        {event && (() => {
          /*
           * U: 保存する状態を出す。R81: 公開中でも今後の枠が無ければ
           * 「終了」。枠が読めていないときは断定せず、公開中と出す。
           */
          const nowMs = Date.now()
          const hasFuture = slots === null
            ? null
            : slots.some((s) => s.is_active === 1 && Date.parse(s.starts_at) >= nowMs)
          const lifecycle = event.lifecycle_status ?? (event.is_published === 1 ? 'published' : 'draft')
          if (lifecycle === 'draft') {
            return (
              <span className="rounded-pill bg-canvas-sunken text-ink-faint px-2 py-0.5 text-nano font-medium">
                下書き
              </span>
            )
          }
          if (lifecycle === 'paused') {
            return (
              <span className="rounded-pill bg-warning-bg text-warning px-2 py-0.5 text-nano font-medium">
                一時停止
              </span>
            )
          }
          if (lifecycle === 'cancelled') {
            return (
              <span className="rounded-pill bg-canvas-sunken text-ink-faint px-2 py-0.5 text-nano font-medium">
                中止
              </span>
            )
          }
          if (lifecycle === 'ended' || hasFuture === false) {
            return (
              <span className="rounded-pill bg-canvas-sunken text-ink-faint px-2 py-0.5 text-nano font-medium">
                終了
              </span>
            )
          }
          return (
            <span className="rounded-pill bg-success-bg text-success px-2 py-0.5 text-nano font-medium">
              公開中
            </span>
          )
        })()}
        <Link
          href={`/events/bookings?id=${eventId}`}
          className="text-action ml-auto text-xs hover:underline"
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

/**
 * U: 状態の切替（下書き・公開中・一時停止・終了・中止）。
 * 今の状態から進める先だけを出し、一時停止と中止は理由を聞く。
 * 理由は変更の記録に残る。
 */
const NEXT_LIFECYCLE: Record<EventLifecycleStatus, Array<{ to: EventLifecycleStatus; label: string; needsReason: boolean }>> = {
  draft: [{ to: 'published', label: '公開する', needsReason: false }],
  published: [
    { to: 'paused', label: '一時停止する', needsReason: true },
    { to: 'ended', label: '終了する', needsReason: false },
    { to: 'cancelled', label: '中止する', needsReason: true },
  ],
  paused: [
    { to: 'published', label: '再開する', needsReason: false },
    { to: 'ended', label: '終了する', needsReason: false },
    { to: 'cancelled', label: '中止する', needsReason: true },
  ],
  ended: [],
  cancelled: [],
}

function LifecycleSection({ accountId, eventId, onChanged }: { accountId: string; eventId: string; onChanged?: () => void }) {
  const [lifecycle, setLifecycle] = useState<EventLifecycleStatus | null>(null)
  /* WEB318：読めなかったことを「読み込んでいます」のまま残さない。 */
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadSeq, setLoadSeq] = useState(0)
  const [pending, setPending] = useState<{ to: EventLifecycleStatus; label: string; needsReason: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKeyRef = useRef(crypto.randomUUID())

  useEffect(() => {
    let cancelled = false
    setLifecycle(null)
    setLoadFailed(false)
    void eventsApi.getEvent(accountId, eventId).then(
      (detail) => {
        if (cancelled) return
        setLifecycle(detail.lifecycle_status ?? (detail.is_published === 1 ? 'published' : 'draft'))
      },
      () => {
        if (cancelled) return
        setLifecycle(null)
        setLoadFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [accountId, eventId, loadSeq])

  const runSwitch = async () => {
    if (!pending || busy) return
    const trimmed = reason.trim()
    if (pending.needsReason && trimmed === '') return
    setBusy(true)
    setError('')
    try {
      const result = await eventsApi.setEventLifecycle(accountId, eventId, {
        to: pending.to,
        reason: trimmed === '' ? undefined : trimmed,
        idempotency_key: idempotencyKeyRef.current,
      })
      idempotencyKeyRef.current = crypto.randomUUID()
      setLifecycle(result.lifecycle_status)
      setPending(null)
      setReason('')
      onChanged?.()
    } catch (err) {
      const code = (err as { body?: { error?: string } }).body?.error
      setError(
        code === 'lifecycle_transition_invalid'
          ? 'いまの状態からは変えられません。開き直して最新の状態で、もう一度お試しください。'
          : '変えられませんでした。時間をおいて、もう一度お試しください。',
      )
    } finally {
      setBusy(false)
    }
  }

  const options = lifecycle ? NEXT_LIFECYCLE[lifecycle] : []
  return (
    <section className="bg-canvas rounded-card border-hairline border p-4" aria-label="公開の状態">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-ink text-sm font-bold">公開の状態</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {options.map((option) => (
            <Button
              key={option.to}
              variant="secondary"
              onClick={() => {
                setReason('')
                setError('')
                setPending(option)
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      {lifecycle === null && !loadFailed && (
        <p className="text-ink-faint mt-2 text-xs">状態を読み込んでいます…</p>
      )}
      {lifecycle === null && loadFailed && (
        <Notice
          tone="warn"
          message="公開の状態を読み込めませんでした。"
          action={<button className="font-semibold underline" onClick={() => setLoadSeq((n) => n + 1)}>読み直す</button>}
          className="mt-2"
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        title={`このイベントを${pending?.label ?? '変える'}？`}
        description={
          pending?.to === 'cancelled'
            ? '中止にすると申込の受付は止まり、申込の履歴は残ります。元に戻すことはできません。'
            : pending?.to === 'paused'
              ? '一時停止中はお客様の画面から申込ができなくなります。申込の履歴は残ります。'
              : '状態を変えます。'
        }
        confirmLabel={pending?.label ?? '変える'}
        cancelLabel="キャンセル"
        busy={busy}
        error={error}
        onConfirm={() => void runSwitch()}
        onCancel={() => {
          if (busy) return
          setPending(null)
          setReason('')
          setError('')
        }}
      >
        {pending?.needsReason && (
          <label className="block">
            <span className="text-ink-faint text-xs">理由（必須・変更の記録に残ります）</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="例：台風のため今週の受付を止めます"
              className="border-hairline rounded-control mt-1 w-full border px-3 py-2 text-sm"
            />
          </label>
        )}
      </ConfirmDialog>
    </section>
  )
}

function EditEventInner() {
  const params = useSearchParams()
  const id = params.get('id')
  const { selectedAccountId } = useAccount()
  const [statusSeq, setStatusSeq] = useState(0)

  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集するイベントが指定されていません"
        description="一覧から、編集するイベントを選び直してください。"
        backHref="/events"
        backLabel="イベント一覧へ戻る"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="v8-only"><PageHeading title="イベントの編集" /></div>
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs" data-design="Crumb" aria-label="パンくず">
          <Link href="/events" className="hover:underline">
            イベント予約
          </Link>
          <span className="mx-1.5">/</span>
          <span>編集</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <Button href={`/events/change-review?id=${id}`} variant="secondary">
            変更の影響を確認
          </Button>
          <Button href={`/events/preview?id=${id}`} variant="secondary">
            お客様表示を確認
          </Button>
          <Button href={`/events/bookings?id=${id}`} variant="secondary">
            申込の一覧を見る
          </Button>
        </div>
      </div>

      {!selectedAccountId ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          アカウントを選択してください。
        </p>
      ) : (
        <>
          <BookingStatus accountId={selectedAccountId} eventId={id} refreshKey={statusSeq} />
          <LifecycleSection accountId={selectedAccountId} eventId={id} onChanged={() => setStatusSeq((n) => n + 1)} />
          <div data-design="Body">
            <EventForm accountId={selectedAccountId} eventId={id} />
          </div>

          <section className="bg-canvas-sunken rounded-card border-hairline border p-4">
            <h2 className="text-ink text-sm font-bold">気をつけること</h2>
            <ul className="text-ink-faint mt-2 space-y-1 text-xs leading-relaxed">
              <li>
                ・承認制の申込は、承認前（承認待ち）の時点から残席を使います。承認・拒否・期限切れで確定または解放されます
              </li>
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
