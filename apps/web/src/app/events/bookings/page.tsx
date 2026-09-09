'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { eventsApi, type EventBookingItem, type EventBookingSummary, type EventDetail } from '@/lib/api'
import { describeBookingCapacity } from '../event-attention'

const PAGE_SIZE = 20

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
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
  rejected: 'bg-canvas-sunken text-ink-secondary',
  cancelled: 'bg-canvas-sunken text-ink-secondary',
  expired: 'bg-canvas-sunken text-ink-faint',
  attended: 'bg-accent-soft text-accent',
  no_show: 'bg-danger-bg text-danger',
  waitlist: 'bg-warning-bg text-warning',
}

const STATUS_LABELS = new Map([
  ...STATUS_TABS.map(({ key, label }) => [key, label] as const),
  ['waitlist', 'キャンセル待ち'] as const,
])

function formatJp(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

/**
 * 記録の宛先。**押した時点のLINEアカウントとイベントを鍵に含める。**
 * 予約IDだけで数えると、切り替えたあとの画面でも同じ鍵になり、前の
 * アカウントへ投げた更新が今の行の状態として扱われる。
 */
function bookingScopeKey(accountId: string | null, eventId: string | null): string {
  return JSON.stringify([accountId, eventId])
}

function bookingActionKey(accountId: string, eventId: string, bookingId: string): string {
  return JSON.stringify([accountId, eventId, bookingId])
}

/** 切替のたびに新しい入れ物を作らないための空。中身は書き換えない。 */
const EMPTY_MARKING_KEYS: ReadonlySet<string> = new Set<string>()
const EMPTY_MARK_ERRORS: Record<string, string> = {}

function BookingsInner() {
  const params = useSearchParams()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [bookingsTotal, setBookingsTotal] = useState(0)
  const [summary, setSummary] = useState<EventBookingSummary | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tab, setTab] = useState<string>('requested')
  const [page, setPage] = useState(1)
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
  const [markingKeys, setMarkingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [markErrors, setMarkErrors] = useState<Record<string, string>>({})
  /*
   * 画面更新を待たずに同じ行の二度押しを止める。state だけでは、最初の
   * click の再描画より先に二度目の click が入り、2本ともAPIへ届く。
   */
  const markingKeysRef = useRef(new Set<string>())
  const markRequestRef = useRef(new Map<string, number>())
  /*
   * 送った順に番号を振る。行ごとの数え上げだと、切り替えて戻ってから
   * 同じ行を押し直したときに番号が振り出しへ戻り、**まだ返ってきて
   * いない前の応答が「最新」に見える。**
   */
  const markSeqRef = useRef(0)
  /*
   * 記録の世代。アカウントかイベントが変わるたびに上げ、**切替前に
   * 押した更新の応答を、成功でも失敗でも画面へ書かせない。**
   */
  const markGenerationRef = useRef(0)
  /** 今どのアカウントの、どのイベントを見ているか。応答の照合に使う。 */
  const scopeRef = useRef(bookingScopeKey(selectedAccountId, eventId))
  /** 切り替え前の遅い応答を、次のイベント・次の絞り込みの一覧へ混ぜない。 */
  const loadRequestRef = useRef(0)
  const summaryRequestRef = useRef(0)

  /*
   * **アカウント・イベントを切り替えたら、進行中の記録を失効させる。**
   *
   * Aで「参加済」を押したまま切り替えてBを表示し、そのあとAの更新が
   * 成功で返ると、前は行の書き換えと再取得・集計がそのまま走り、
   * **Bの画面へAの予約者と件数が入り込んだ。** 誰の予約を見ているのか
   * 分からないまま、Bの承認待ちを見落とす。世代を上げて、旧アカウント
   * の応答には一切書かせない。
   *
   * **描いている時点で失効させる。** これを `useEffect` に置くと、
   * Bを描き終えてから後片付けが動くまでの隙間ができる。**その隙間で
   * Aの応答が返ると、まだAのままの宛先を「今の宛先」と読んでしまい、
   * 行の書き換えとAの取り直しへ進む。** 描画のたびに宛先を見て、
   * 変わっていれば同じ描画のうちに世代を上げる。
   */
  const scope = bookingScopeKey(selectedAccountId, eventId)
  if (scopeRef.current !== scope) {
    scopeRef.current = scope
    markGenerationRef.current += 1
    markRequestRef.current.clear()
    markingKeysRef.current.clear()
  }
  /*
   * 行の「記録中…」と失敗文も、Bを画面へ出す前に畳む。描画中に
   * 直すので、切替後の最初の絵から前のアカウントの操作跡が消える。
   */
  const [markScope, setMarkScope] = useState(scope)
  if (markScope !== scope) {
    setMarkScope(scope)
    setMarkingKeys(EMPTY_MARKING_KEYS)
    setMarkErrors(EMPTY_MARK_ERRORS)
  }
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
  const [rejectTarget, setRejectTarget] = useState<EventBookingItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const dataReady = summaryStatus === 'ready' && summary !== null
  usePageTitle(event?.name ? event.name + ' の申込者' : 'イベントの申込者')

  // タブ切替では申込一覧だけ取り直す(点検#520軽13)。詳細・待ち列はタブと無関係。
  const refreshList = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    const requestId = ++loadRequestRef.current
    /*
      **番号だけでは足りない。** 切り替え前に押した記録の成功から
      呼ばれると、この取得自体が古い宛先のまま最新の番号を取り、
      **今の画面へ前のアカウントの一覧を書き込む。** 番号を見たあと、
      始めた時点の宛先(`scope`)と今の宛先も照らし合わせる。
    */
    setLoadStatus('loading')
    setActionError(null)
    try {
      const filters = tab === 'all' ? {} : { status: tab }
      // タブとページの切替では、この一覧だけを取り直す。
      const listRes = await eventsApi.listBookings(selectedAccountId, eventId, {
        ...filters,
        page,
        limit: PAGE_SIZE,
      })
      if (requestId !== loadRequestRef.current) return
      if (scopeRef.current !== scope) return
      /*
        **器の形を確かめてから入れる。** `items` が無い返事をそのまま
        入れると、下の `filter` で**画面ごと落ちる。** 取れなかったのと
        同じ扱いにして、失敗の言葉を出す。
      */
      if (!Array.isArray(listRes?.items)) throw new Error('malformed')
      setItems(listRes.items)
      setBookingsTotal(typeof listRes.total === 'number' ? listRes.total : listRes.items.length)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      if (scopeRef.current !== scope) return
      /*
        **数を持ち越さない。** 前の絞り込みの行を残したまま失敗を出すと、
        古い数の上に「取れませんでした」が乗って、どちらが本当か読めない。
      */
      setItems([])
      setBookingsTotal(0)
      setLoadStatus('error')
    }
  }, [selectedAccountId, eventId, scope, tab, page])

  // 詳細はイベント/アカウント変更時のみ取り直す(点検#520軽13)。
  // 待ち列の件数は概要(summary)から取るようになったため、ここでは読まない。
  const refreshMeta = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    const requestId = ++loadRequestRef.current
    try {
      /*
        **前のイベントの控えを使い回さない。** `event` が入っていれば取りに
        行かない作りだったので、アカウントやイベントを切り替えたあとも
        **上の帯に前のイベント名と定員が残った。** どのイベントの
        申込を見ているのか読み違える。毎回取り直す。
      */
      const evRes = await eventsApi.getEvent(selectedAccountId, eventId)
      if (requestId !== loadRequestRef.current) return
      if (scopeRef.current !== scope) return
      setEvent((current) => (typeof evRes?.name === 'string' ? evRes : current))
    } catch {
      if (requestId !== loadRequestRef.current) return
      if (scopeRef.current !== scope) return
      setEvent(null)
    }
  }, [selectedAccountId, eventId, scope])

  const refresh = useCallback(async () => {
    await refreshMeta()
    await refreshList()
    // 控えの `event` を読まなくなったので、依存の除外は要らない。
  }, [refreshMeta, refreshList])

  useEffect(() => {
    void refreshMeta()
  }, [refreshMeta])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const refreshSummary = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    const requestId = ++summaryRequestRef.current
    setSummaryStatus('loading')
    try {
      const [eventRes, summaryRes] = await Promise.all([
        eventsApi.getEvent(selectedAccountId, eventId),
        eventsApi.getBookingSummary(selectedAccountId, eventId),
      ])
      if (requestId !== summaryRequestRef.current) return
      if (scopeRef.current !== scope) return
      setEvent(eventRes)
      setSummary(summaryRes)
      setSummaryStatus('ready')
    } catch {
      if (requestId !== summaryRequestRef.current) return
      if (scopeRef.current !== scope) return
      setEvent(null)
      setSummary(null)
      setSummaryStatus('error')
    }
  }, [selectedAccountId, eventId, scope])

  useEffect(() => {
    void refreshSummary()
    return () => {
      summaryRequestRef.current += 1
    }
  }, [refreshSummary])

  useEffect(() => {
    setPage(1)
  }, [selectedAccountId, eventId])

  if (!eventId) {
    return <div className="text-danger p-4">イベントを選び直してください</div>
  }

  /*
   * **ブラウザの `window.prompt` で理由を聞かない。**
   *
   * 見た目がブラウザ任せで設計の窓と違ううえ、画像比較にも写らないので
   * **拒否の絵をそもそも撮れない。** 加えて、prompt は「これが友だちに
   * 見えるのか」を書ける場所が無く、**内部メモのつもりで書いた文が
   * 相手に届くと思わせる。** 画面の中の窓で、誰の予約か・理由は
   * 内部にしか残らないことを読ませる。
   */
  async function decide(id: string, action: 'confirm' | 'reject', reason?: string) {
    if (!selectedAccountId || !eventId || busy) return
    setBusy(true)
    try {
      await eventsApi.decideBooking(selectedAccountId, eventId, id, action, reason)
      if (action === 'reject') {
        setRejectTarget(null)
        setRejectReason('')
        setRejectError('')
      }
      await Promise.all([refresh(), refreshSummary()])
    } catch {
      /*
        **内部の文字をそのまま出さない。** `e.message` は
        `API error: 409` のような形で出る。何を直せばよいか分からない。
      */
      if (action === 'reject') {
        setRejectError('予約を拒否できませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。')
      } else {
        setActionError('予約を確定できませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。')
      }
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
      await Promise.all([refresh(), refreshSummary()])
    } catch {
      setCancelError(
        'この予約をキャンセルできませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。',
      )
    } finally {
      setCancelling(false)
      setBusy(false)
    }
  }

  /**
   * 来場・不参加を記録する。
   *
   * **宛先を押した時点で固定する。** `selectedAccountId` は待っている間に
   * 変わるので、更新の送信先も、返ってきたあとの照合も、押した時点の
   * 値で行う。返事が届いたら、行の書き換え・一覧の取り直し・集計の
   * 取り直しの**どれを行う前にも**、押した時点の宛先と世代が今も
   * 生きているかを確かめる。**旧アカウントの成功をBの画面へ
   * 書き込ませない。**
   */
  async function markStatus(id: string, status: 'attended' | 'no_show') {
    const accountId = selectedAccountId
    if (!accountId || !eventId) return
    // `scope` は今描いている宛先。押した時点の値をそのまま持ち回る。
    const startedScope = scope
    const actionKey = bookingActionKey(accountId, eventId, id)
    if (markingKeysRef.current.has(actionKey)) return
    const generation = markGenerationRef.current
    const requestId = ++markSeqRef.current
    markRequestRef.current.set(actionKey, requestId)
    markingKeysRef.current.add(actionKey)
    setMarkingKeys(new Set(markingKeysRef.current))
    setMarkErrors((current) => {
      if (!(actionKey in current)) return current
      const next = { ...current }
      delete next[actionKey]
      return next
    })
    const isCurrent = () => (
      markGenerationRef.current === generation
      && scopeRef.current === startedScope
      && markRequestRef.current.get(actionKey) === requestId
    )
    try {
      await eventsApi.updateBooking(accountId, eventId, id, { status })
      if (!isCurrent()) return
      setItems((current) => current.map((booking) => (
        booking.id === id ? { ...booking, status } : booking
      )))
      /*
        `refresh` と `refreshSummary` は押した時点のアカウントを掴んで
        いる。切り替わったあとに呼ぶと、**前のアカウントの一覧と件数を
        取りに行き、今の画面へ入れてしまう。** 呼ぶ直前にもう一度見る。
      */
      if (!isCurrent()) return
      await Promise.all([refresh(), refreshSummary()])
    } catch {
      if (!isCurrent()) return
      setMarkErrors((current) => ({
        ...current,
        [actionKey]: '来場・不参加の記録を変えられませんでした。一覧を読み直してから、もう一度お試しください。',
      }))
    } finally {
      if (isCurrent()) {
        markingKeysRef.current.delete(actionKey)
        setMarkingKeys(new Set(markingKeysRef.current))
      }
    }
  }

  const confirmed = summary?.confirmed ?? 0
  const pending = summary?.requested ?? 0
  const cancelled = summary?.cancelled ?? 0
  const applied = confirmed + pending
  const capacity = summary?.totalCapacity ?? 0
  const pageCount = Math.max(1, Math.ceil(bookingsTotal / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)

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

      <div data-design="Head" className="mb-4">
        <h2 className="text-ink text-lg font-semibold">イベントの予約者</h2>
        <p className="text-ink-faint mt-1 text-sm">
          申込の確認・承認・キャンセルを行います。承認制のイベントは、承認するまで確定しません。
          マニュアル・CSVで書き出す・予約者に一斉送信は、接続後にここから使えます。
        </p>
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
          value={dataReady ? String(applied) : '—'}
          unit={dataReady ? '人' : ''}
          detail={!dataReady
            ? '取得できませんでした'
            : /*
                残りの席数を出すだけだと、**あと2席なのか20席なのかで
                同じ言い方**になる。一覧の「あと少しで満席」と同じ
                目安（残り1〜3席）で、声をかける回だけ言い方を変える。
              */
              describeBookingCapacity(applied, capacity)}
        />
        {/*
          **数の下に「次にすること」を書く。** 「対応が必要」だけだと、
          0件のときも同じ文が出て、**対応するものが有るのか無いのかが
          添え字から読めない。**
        */}
        <EventKpi
          title="承認待ち"
          value={dataReady ? String(pending) : '—'}
          unit={dataReady ? '件' : ''}
          detail={dataReady
            ? pending > 0 ? `対応が必要：${pending}件を確認してください` : '確認待ちはありません'
            : '取得できませんでした'}
        />
        {/* 実APIでは別の待ち列だが、画面確認用の応答は同じ一覧に含む。
            行が無いときは設定だけを示し、人数を推測しない。 */}
        <EventKpi
          title="キャンセル待ち"
          value={dataReady ? String(summary?.waitlist ?? 0) : '—'}
          unit={dataReady ? '人' : ''}
          /*
            **読めていない設定を言い切らない。** `event` が取れていないと
            `waitlist_enabled` は undefined で、前は必ず「受け付けない設定です」
            と出ていた。**受け付ける設定なのに受け付けないと読める。**
          */
          detail={!dataReady
            ? '取得できませんでした'
            : (summary?.waitlist ?? 0) > 0
              ? '取り消しが出たら順に案内します'
              : event?.waitlist_enabled ? '空きが出たら順に案内' : '受け付けない設定です'}
        />
        <EventKpi
          title="キャンセル"
          value={dataReady ? String(cancelled) : '—'}
          unit={dataReady ? '件' : ''}
          detail={dataReady
            ? cancelled > 0 ? '空いた枠を確認してください' : 'キャンセルはありません'
            : '取得できませんでした'}
        />
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

        <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <div className="border-hairline flex overflow-x-auto border-b">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setPage(1)
                  setTab(t.key)
                }}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-accent text-accent bg-accent-soft'
                    : 'text-ink-secondary hover:bg-canvas-sunken border-transparent'
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
              action={<Button onClick={() => void Promise.all([refresh(), refreshSummary()])}>予約を再読み込み</Button>}
            />
          ) : items.length === 0 ? (
            <div className="text-ink-faint p-12 text-center text-sm">
              該当する予約はありません
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-sm">
                <thead className="bg-canvas-sunken text-ink-secondary">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">申込者</th>
                    <th className="px-4 py-2 text-left font-medium">申し込み</th>
                    <th className="px-4 py-2 text-left font-medium">予約枠</th>
                    <th className="px-4 py-2 text-left font-medium">連れてくるペット</th>
                    <th className="px-4 py-2 text-left font-medium">この方について</th>
                    <th className="px-4 py-2 text-right font-medium">状態と操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => {
                    const acct = accounts.find((a) => a.id === b.line_account_id)
                    const friendName = b.friend_display_name ?? b.friend_name
                    const actionKey = selectedAccountId
                      ? bookingActionKey(selectedAccountId, eventId, b.id)
                      : ''
                    const marking = markingKeys.has(actionKey)
                    const accountLabel = acct
                      ? `${acct.country ? acct.country + ' ' : ''}${acct.name}`
                      : b.line_account_name
                        ? b.line_account_name
                      /* **内部IDを画面に出さない。** 運用者にとって手がかりにならない。 */
                        : 'アカウントは未取得'
                    return (
                    <tr key={b.id} className="border-hairline hover:bg-canvas-sunken border-t">
                      <td className="text-ink px-4 py-3">
                        <span className="block font-medium">{friendName ?? '友だちは未取得'}</span>
                        <span className="text-ink-faint mt-0.5 block text-xs">{accountLabel}</span>
                      </td>
                      <td className="text-ink-secondary px-4 py-3 text-xs">
                        {formatJp(b.requested_at ?? b.created_at, '受付日時は未取得')}
                      </td>
                      <td className="text-ink-secondary px-4 py-3">
                        {formatJp(b.slot_starts_at, '予約枠は未取得')}
                      </td>
                      <td className="text-ink-secondary px-4 py-3">
                        {b.companion_note ?? '登録情報は未接続'}
                      </td>
                      <td className="text-ink-secondary px-4 py-3">
                        {b.is_first_time == null
                          ? '来店情報は未接続'
                          : b.is_first_time === 1 ? 'はじめての方です' : '来店履歴があります'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`rounded-pill px-2 py-0.5 text-xs font-medium ${statusBadge[b.status] ?? 'bg-canvas-sunken text-ink-secondary'}`}>
                          {STATUS_LABELS.get(b.status) ?? '状態は未取得'}
                        </span>
                        {b.status === 'requested' && (
                          <div className="ml-2 inline-flex gap-1.5">
                            <button
                              onClick={() => decide(b.id, 'confirm')}
                              disabled={busy}
                              className="bg-success text-on-accent rounded-control px-3 py-1 text-xs font-medium hover:brightness-95 disabled:opacity-50"
                            >
                              承認
                            </button>
                            <button
                              data-qa-open="i5SN2j-reject"
                              onClick={() => {
                                setRejectReason('')
                                setRejectError('')
                                setRejectTarget(b)
                              }}
                              disabled={busy}
                              className="bg-ink-secondary text-on-accent rounded-control px-3 py-1 text-xs font-medium hover:brightness-95 disabled:opacity-50"
                            >
                              拒否
                            </button>
                          </div>
                        )}
                        {b.status === 'confirmed' && (
                          <div className="ml-2 inline-flex gap-1.5">
                            <button
                              data-booking-id={b.id}
                              data-booking-action="attended"
                              onClick={() => markStatus(b.id, 'attended')}
                              disabled={busy || marking}
                              className="bg-accent-deep text-on-accent rounded-control px-3 py-1 text-xs font-medium hover:brightness-95 disabled:opacity-50"
                            >
                              {marking ? '記録中…' : '参加済'}
                            </button>
                            <button
                              data-booking-id={b.id}
                              data-booking-action="no_show"
                              onClick={() => markStatus(b.id, 'no_show')}
                              disabled={busy || marking}
                              className="bg-danger text-on-accent rounded-control px-3 py-1 text-xs font-medium hover:brightness-95 disabled:opacity-50"
                            >
                              {marking ? '記録中…' : '無断'}
                            </button>
                            <button
                              data-qa-open="i5SN2j-cancel"
                              onClick={() => {
                                if (!selectedAccountId) return
                                setCancelError('')
                                setCancelTarget({ booking: b, accountId: selectedAccountId })
                              }}
                              disabled={busy}
                              className="border-hairline rounded-control hover:bg-canvas border px-3 py-1 text-xs font-medium disabled:opacity-50"
                            >
                              キャンセル
                            </button>
                            {markErrors[actionKey] && (
                              <span className="text-danger block max-w-64 text-left text-xs" role="alert">
                                {markErrors[actionKey]}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-hairline flex items-center justify-between border-t px-4 py-3">
              <span className="text-ink-faint text-xs">
                {(currentPage - 1) * PAGE_SIZE + 1}〜{Math.min(currentPage * PAGE_SIZE, bookingsTotal)}件 / 全{bookingsTotal}件
              </span>
              <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
            </div>
            </>
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
              {cancelTarget.booking.friend_display_name ?? '友だちは未取得'}
            </p>
            <p>予約枠：{formatJp(cancelTarget.booking.slot_starts_at, '未取得')}</p>
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

      <ConfirmDialog
        open={rejectTarget !== null}
        title="この申し込みを断りますか？"
        description="予約は「拒否」になり、枠が空きます。友だちにはLINEで断りのお知らせが届きます。送ったお知らせは取り消せません。"
        confirmLabel="申し込みを断る"
        cancelLabel="やめる"
        /* 通知が飛び、この画面からは戻せない。だから赤にする。 */
        destructive
        busy={busy}
        error={rejectError}
        onConfirm={() => rejectTarget && void decide(rejectTarget.id, 'reject', rejectReason.trim() || undefined)}
        onCancel={() => {
          if (busy) return
          setRejectTarget(null)
          setRejectReason('')
          setRejectError('')
        }}
      >
        {rejectTarget && (
          <div className="text-ink-secondary space-y-2 text-sm">
            <p>友だち：{rejectTarget.friend_display_name ?? rejectTarget.friend_name ?? '友だちは未取得'}</p>
            <p>予約枠：{formatJp(rejectTarget.slot_starts_at, '未取得')}</p>
            <label className="block">
              <span className="text-ink-faint text-xs">断る理由（任意）</span>
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={3}
                className="border-hairline rounded-control mt-1 w-full border px-3 py-2 text-sm"
                placeholder="例：この回は定員に達したため"
              />
            </label>
            {/*
              **理由がどこへ行くかを書く。** 前はブラウザの prompt で
              「（任意・admin内部メモ。友だちには固定文面）」と括弧書き
              していたが、prompt には**書ける場所が無い**ので読み飛ばされ、
              内部メモのつもりの文が相手に届くと思わせていた。
            */}
            <p className="text-ink-faint text-xs">
              この理由は運営の記録にだけ残ります。友だちには決まったお知らせの文が届きます。
            </p>
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
    <Suspense fallback={<div className="text-ink-faint p-4">読み込み中...</div>}>
      <BookingsInner />
    </Suspense>
  )
}
