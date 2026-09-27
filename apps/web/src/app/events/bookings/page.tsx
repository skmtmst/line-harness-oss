'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import Pagination from '@/components/shared/pagination'
import SelectField from '@/components/shared/select-field'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
// #740: 一覧の Kpi と一字一句同じだったため、機能内共有の1部品へ統合した。
import EventKpi from '@/components/events/event-kpi'
import { parseEventQuestions } from '@/components/events/event-questions-editor'
import {
  api,
  eventsApi,
  type EventBookingItem,
  type EventBookingSummary,
  type EventDetail,
  type EventOccurrenceApplicants,
  type EventSlot,
} from '@/lib/api'
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

/** 予約・申込の状態の見え方。**色だけに頼らず、必ず文字で言う。** */
const statusTone: Record<string, StatusBadgeTone> = {
  requested: 'warning',
  confirmed: 'success',
  rejected: 'neutral',
  cancelled: 'neutral',
  expired: 'neutral',
  attended: 'success',
  no_show: 'danger',
  waitlist: 'warning',
  waiting: 'warning',
  offered: 'info',
  accepted: 'success',
  converted: 'success',
}

const STATUS_LABELS = new Map([
  ...STATUS_TABS.map(({ key, label }) => [key, label] as const),
  ['waitlist', 'キャンセル待ち'] as const,
  ['waiting', '待機中'] as const,
  ['offered', '案内中'] as const,
  ['accepted', '受諾済み'] as const,
])

/** IDEA-29: 繰上げ履歴の終了状態を運用の言葉で示す。 */
const WAITLIST_HISTORY_LABELS: Record<string, string> = {
  converted: '予約に繰上げ',
  expired: '案内が期限切れ',
  cancelled: '本人が取消',
}

function sumPartySize(rows: Array<{ partySize: number }>): number {
  return rows.reduce((total, row) => total + row.partySize, 0)
}

/*
 * IDEA-07: 予約に紐づく自動お知らせの予定を、予約そのもののそばで見せる。
 * 開催回の移動や取消で止まった分も「停止済み」として出し、
 * 古い通知が残っていないか・二重になっていないかをこの一覧で確かめられる。
 * 別管理の通知一覧は作らず、変更に連動するこの場所だけで見せる。
 */
const REMINDER_KIND_LABELS: Record<string, string> = {
  day_before: '前日のお知らせ',
  hours_before: '開始前のお知らせ',
}

const REMINDER_STATUS_LABELS: Record<string, string> = {
  pending: '送信予定',
  sent: '送信済み',
  cancelled: '停止済み',
  failed: '失敗',
  failed_permanent: '失敗',
}

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

function OccurrenceApplicantsPanel({
  data,
  promoting,
  error,
  onPromote,
  onExportCsv,
  csvBusy,
}: {
  data: EventOccurrenceApplicants
  promoting: boolean
  error: string
  onPromote: () => void
  /*
   * TECH-03: CSVは直リンクではなく認証付き取得で取る。
   * Cookie が届かない経路では href の直開きが401になるため。
   */
  onExportCsv: () => void
  csvBusy: boolean
}) {
  const waitlistRows = data.applicants.filter((applicant) => applicant.source === 'waitlist')
  const waitingRows = waitlistRows.filter((applicant) => applicant.status === 'waiting')
  const waitingCount = waitingRows.length

  /*
   * IDEA-29: 申込・確定・残席・キャンセル待ち・案内済みを分けて見せる。
   * 人数(party_size 合計)で数える。旧応答に新しい集計が無いときは、
   * 同じ応答の申込者行から数え直す(行は全件返る)。
   */
  const bookingRows = data.applicants.filter((applicant) => applicant.source === 'booking')
  const confirmedSeats = data.summary.confirmedSeats
    ?? sumPartySize(bookingRows.filter((row) => row.status === 'confirmed'))
  const requestedSeats = data.summary.requestedSeats
    ?? sumPartySize(bookingRows.filter((row) => row.status === 'requested'))
  const waitingSeats = data.summary.waitingSeats
    ?? sumPartySize(waitingRows)
  const offeredSeats = data.summary.offeredSeats
    ?? sumPartySize(waitlistRows.filter((row) => row.status === 'offered' || row.status === 'accepted'))
  const remainingSeats = data.summary.remainingSeats
    ?? (data.occurrence.capacity == null
      ? null
      : Math.max(0, data.occurrence.capacity - data.occurrence.activeSeats))
  const waitlistHistory = data.waitlistHistory ?? []
  const attendance = data.attendance ?? null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-secondary text-sm">
          申込 {confirmedSeats + requestedSeats}人
          （確定 {confirmedSeats}人・承認待ち {requestedSeats}人）
          ・キャンセル待ち {waitingSeats}人・案内中 {offeredSeats}人
          {data.occurrence.capacity == null
            ? ' / 定員の上限なし'
            : remainingSeats === 0
              ? ` / 満席（定員 ${data.occurrence.capacity}人）`
              : ` / 残席 ${remainingSeats}席（定員 ${data.occurrence.capacity}人）`}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExportCsv}
            disabled={csvBusy}
            className="text-action text-xs font-medium hover:underline disabled:opacity-50"
          >
            {csvBusy ? '書き出しています…' : 'CSVを書き出す'}
          </button>
          <Button
            onClick={onPromote}
            disabled={promoting || waitingCount === 0}
            data-occurrence-action="promote-waitlist"
          >
            {promoting ? '案内を送信中…' : '次の方へ案内'}
          </Button>
        </div>
      </div>
      {error && <p className="text-danger mb-3 text-sm" role="alert">{error}</p>}
      {data.applicants.length === 0 ? (
        <p className="text-ink-faint py-4 text-sm">この開催回には申込者もキャンセル待ちもいません。</p>
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th>申込者</Th><Th>区分・順位</Th><Th>状態</Th><Th>案内期限</Th><Th align="right">操作</Th>
            </TableHeadRow>
          </thead>
            <tbody>
              {data.applicants.map((applicant) => {
                const waitlistRank = applicant.source === 'waitlist' && applicant.status === 'waiting'
                  ? waitingRows.findIndex((row) => row.id === applicant.id) + 1
                  : 0
                return (
                  <Tr key={`${applicant.source}:${applicant.id}`}>
                    <NameCell name={applicant.displayName ?? '友だちは未取得'} sub={`${applicant.partySize}人`} />
                    <Td>
                      {applicant.source === 'waitlist'
                        ? applicant.status === 'waiting' ? `キャンセル待ち ${waitlistRank}番` : 'キャンセル待ち'
                        : '申込'}
                    </Td>
                    <Td>
                      <StatusBadge tone={statusTone[applicant.status] ?? 'neutral'} size="compact">
                        {STATUS_LABELS.get(applicant.status) ?? applicant.status}
                      </StatusBadge>
                    </Td>
                    <Td className="text-xs">
                      {applicant.offerExpiresAt
                        ? formatJp(applicant.offerExpiresAt, '期限は未取得')
                        : applicant.status === 'waiting' ? '案内前' : '—'}
                    </Td>
                    <ActionCell>
                      {/* #641: 行操作は枠つきボタンにそろえる */}
                      <Button
                        href={`/chats?friend=${encodeURIComponent(applicant.friendId)}`}
                        variant="secondary"
                      >
                        個別トーク
                      </Button>
                    </ActionCell>
                  </Tr>
                )
              })}
            </tbody>
        </DataTable>
      )}

      {/*
        IDEA-29: 当日受付。「確定」のままの人は受付前、参加済・無断に記録した
        人は下の行で追う。記録の操作自体は下の予約一覧の既存ボタンで行う。
      */}
      <div className="border-hairline mt-4 border-t pt-3" data-idea29="attendance">
        <h4 className="text-ink text-sm font-medium">当日の受付</h4>
        {attendance === null ? (
          <p className="text-ink-faint mt-1 text-xs">受付の記録はまだ取得できていません。</p>
        ) : (
          <>
            <p className="text-ink-secondary mt-1 text-xs">
              参加済 {attendance.attendedSeats}人・無断欠席 {attendance.noShowSeats}人・受付前 {confirmedSeats}人
            </p>
            {attendance.entries.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <DataTable>
                  <thead>
                    <TableHeadRow>
                      <Th>友だち</Th><Th>結果</Th><Th>記録日時</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {attendance.entries.map((entry) => (
                      <Tr key={entry.id}>
                        <NameCell name={entry.displayName ?? '友だちは未取得'} sub={`${entry.partySize}人`} />
                        <Td><StatusBadge tone={statusTone[entry.status] ?? 'neutral'} size="compact">{STATUS_LABELS.get(entry.status) ?? entry.status}</StatusBadge></Td>
                        <Td className="text-xs">{formatJp(entry.markedAt, '記録日時は未取得')}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            )}
          </>
        )}
      </div>

      {/*
        IDEA-29: 繰上げ履歴。終了した待ち(予約化・期限切れ・取消)だけを出す。
        案内中・待機中は上の一覧にいるので、ここでは結果が出た分を追う。
      */}
      <div className="border-hairline mt-4 border-t pt-3" data-idea29="waitlist-history">
        <h4 className="text-ink text-sm font-medium">繰上げ・案内の履歴</h4>
        {data.waitlistHistory === undefined ? (
          <p className="text-ink-faint mt-1 text-xs">履歴はまだ取得できていません。</p>
        ) : waitlistHistory.length === 0 ? (
          <p className="text-ink-faint mt-1 text-xs">繰上げや案内の履歴はまだありません。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th>友だち</Th><Th>結果</Th><Th>並んだ日時</Th><Th>案内日時</Th><Th>終了日時</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {waitlistHistory.map((entry) => (
                  <Tr key={entry.id}>
                    <NameCell name={entry.displayName ?? '友だちは未取得'} sub={`${entry.partySize}人`} />
                    <Td><StatusBadge tone={statusTone[entry.status] ?? 'neutral'} size="compact">{WAITLIST_HISTORY_LABELS[entry.status] ?? STATUS_LABELS.get(entry.status) ?? entry.status}</StatusBadge></Td>
                    <Td className="text-xs">{formatJp(entry.createdAt, '—')}</Td>
                    <Td className="text-xs">
                      {entry.offeredAt ? formatJp(entry.offeredAt, '案内日時は未取得') : '案内なし'}
                    </Td>
                    <Td className="text-xs">{formatJp(entry.updatedAt, '—')}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </div>
    </div>
  )
}

function BookingsInner() {
  const params = useSearchParams()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  // #841: 回答に質問文を付けるための定義。Workerは questions_json の
  // 文字列で返すのでここでほぐす。未取得なら回答はid表記になる。
  const eventQuestions = parseEventQuestions(event?.questions_json)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [bookingsTotal, setBookingsTotal] = useState(0)
  const [summary, setSummary] = useState<EventBookingSummary | null>(null)
  const [occurrenceSlots, setOccurrenceSlots] = useState<EventSlot[]>([])
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState('')
  const [occurrenceApplicants, setOccurrenceApplicants] = useState<EventOccurrenceApplicants | null>(null)
  const [occurrenceStatus, setOccurrenceStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [promotingWaitlist, setPromotingWaitlist] = useState(false)
  const [occurrenceActionError, setOccurrenceActionError] = useState('')
  /* TECH-03: 申込者CSVの書出し中。失敗は occurrenceActionError へ出す。 */
  const [csvBusy, setCsvBusy] = useState(false)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastPreview, setBroadcastPreview] = useState<{ broadcastId: string; recipientCount: number; scope: string } | null>(null)
  const [broadcastBusy, setBroadcastBusy] = useState(false)
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false)
  const [broadcastError, setBroadcastError] = useState('')
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
  const occurrenceSlotsRequestRef = useRef(0)
  const occurrenceApplicantsRequestRef = useRef(0)
  const broadcastPreviewKeyRef = useRef<string | null>(null)

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
   * Aの操作中表示をBへ持ち込まない。旧Promiseのfinallyはscope guardで
   * 書き戻せないため、切替直後のB側で操作状態を新しい空へ戻す。
   */
  const [occurrenceOperationScope, setOccurrenceOperationScope] = useState(scope)
  if (occurrenceOperationScope !== scope) {
    setOccurrenceOperationScope(scope)
    setPromotingWaitlist(false)
    setOccurrenceActionError('')
    setBroadcastBusy(false)
    setBroadcastConfirmOpen(false)
    setBroadcastPreview(null)
    broadcastPreviewKeyRef.current = null
    setBroadcastMessage('')
    setBroadcastError('')
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

  /*
   * 申込者はイベント全体ではなく開催回ごとに扱う。枠を選ばずに待機列を
   * まとめると、別日の人へ案内してしまうため、選択中の開催回だけを読む。
   */
  const refreshOccurrenceSlots = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    const requestId = ++occurrenceSlotsRequestRef.current
    setOccurrenceStatus('loading')
    setOccurrenceActionError('')
    try {
      const response = await eventsApi.listOccurrenceSelector(selectedAccountId, eventId)
      if (requestId !== occurrenceSlotsRequestRef.current || scopeRef.current !== scope) return
      const slots = Array.isArray(response?.items) ? response.items.filter((slot) => slot.is_active === 1) : []
      setOccurrenceSlots(slots)
      setSelectedOccurrenceId((current) => slots.some((slot) => slot.id === current) ? current : (slots[0]?.id ?? ''))
      if (slots.length === 0) {
        setOccurrenceApplicants(null)
        setOccurrenceStatus('ready')
      }
    } catch {
      if (requestId !== occurrenceSlotsRequestRef.current || scopeRef.current !== scope) return
      setOccurrenceSlots([])
      setSelectedOccurrenceId('')
      setOccurrenceApplicants(null)
      setOccurrenceStatus('error')
    }
  }, [selectedAccountId, eventId, scope])

  const refreshOccurrenceApplicants = useCallback(async () => {
    if (!selectedAccountId || !selectedOccurrenceId) return
    const requestId = ++occurrenceApplicantsRequestRef.current
    setOccurrenceStatus('loading')
    setOccurrenceActionError('')
    try {
      const data = await eventsApi.getOccurrenceApplicants(selectedAccountId, selectedOccurrenceId)
      if (requestId !== occurrenceApplicantsRequestRef.current || scopeRef.current !== scope) return
      setOccurrenceApplicants(data)
      setBroadcastPreview(null)
      setBroadcastConfirmOpen(false)
      broadcastPreviewKeyRef.current = null
      setOccurrenceStatus('ready')
    } catch {
      if (requestId !== occurrenceApplicantsRequestRef.current || scopeRef.current !== scope) return
      setOccurrenceApplicants(null)
      setOccurrenceStatus('error')
    }
  }, [selectedAccountId, selectedOccurrenceId, scope])

  useEffect(() => {
    setOccurrenceApplicants(null)
    setSelectedOccurrenceId('')
    void refreshOccurrenceSlots()
  }, [refreshOccurrenceSlots])

  useEffect(() => {
    if (!selectedOccurrenceId) return
    void refreshOccurrenceApplicants()
  }, [refreshOccurrenceApplicants, selectedOccurrenceId])

  useEffect(() => {
    setPage(1)
  }, [selectedAccountId, eventId])

  if (!eventId) {
    /* #975 U070: イベント未指定は行き止まりにしない。一覧へ戻る入口を出す。 */
    return (
      <TargetMissing
        kind="unspecified"
        title="どのイベントの申込かが決まっていません"
        description="イベントの一覧から選び直してください。"
        backHref="/events"
        backLabel="イベント一覧へ戻る"
      />
    )
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

  /*
   * TECH-03: 申込者CSVは認証付き取得から保存する。直リンクは
   * Cookie が届かない経路（cross-site の Bearer 補完など）で401になる。
   */
  async function exportApplicantsCsv() {
    const accountId = selectedAccountId
    const applicants = occurrenceApplicants
    if (!accountId || !applicants || csvBusy) return
    const startedScope = scope
    setCsvBusy(true)
    setOccurrenceActionError('')
    try {
      await eventsApi.downloadOccurrenceApplicantsCsv(accountId, applicants.occurrence.id, applicants.snapshotId)
    } catch {
      if (scopeRef.current === startedScope) {
        setOccurrenceActionError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。')
      }
    } finally {
      if (scopeRef.current === startedScope) setCsvBusy(false)
    }
  }

  async function promoteWaitlist() {
    const accountId = selectedAccountId
    const occurrence = occurrenceApplicants?.occurrence
    if (!accountId || !occurrence || promotingWaitlist) return
    const startedScope = scope
    setPromotingWaitlist(true)
    setOccurrenceActionError('')
    try {
      await eventsApi.promoteOccurrenceWaitlist(accountId, occurrence.id, occurrence.version)
      if (scopeRef.current !== startedScope) return
      await refreshOccurrenceApplicants()
    } catch {
      if (scopeRef.current !== startedScope) return
      /* 409を含め、再読込して最新の順位・期限を先に見せる。 */
      await refreshOccurrenceApplicants()
      if (scopeRef.current === startedScope) {
        setOccurrenceActionError('案内を更新できませんでした。ほかの操作で順番や空席が変わった可能性があります。最新の状態を読み直してから、もう一度お試しください。')
      }
    } finally {
      if (scopeRef.current === startedScope) setPromotingWaitlist(false)
    }
  }

  async function previewOccurrenceBroadcast() {
    const accountId = selectedAccountId
    const occurrence = occurrenceApplicants?.occurrence
    const message = broadcastMessage.trim()
    if (!accountId || !occurrence || !message || broadcastBusy) return
    const startedScope = scope
    setBroadcastBusy(true)
    setBroadcastError('')
    try {
      const idempotencyKey = broadcastPreviewKeyRef.current ?? crypto.randomUUID()
      broadcastPreviewKeyRef.current = idempotencyKey
      const result = await eventsApi.previewOccurrenceBroadcast(accountId, occurrence.id, {
        title: `${event?.name ?? 'イベント'}の申込者への案内`,
        messageContent: message,
        snapshotId: occurrenceApplicants.snapshotId,
      }, idempotencyKey)
      if (scopeRef.current !== startedScope) return
      setBroadcastPreview({ ...result, scope: startedScope })
    } catch {
      if (scopeRef.current !== startedScope) return
      setBroadcastError('対象を確定できませんでした。内容を確認して、もう一度お試しください。')
    } finally {
      if (scopeRef.current === startedScope) setBroadcastBusy(false)
    }
  }

  async function sendOccurrenceBroadcast() {
    if (!broadcastPreview || broadcastPreview.scope !== scope || broadcastBusy) return
    const startedScope = scope
    setBroadcastBusy(true)
    setBroadcastError('')
    try {
      await api.broadcasts.send(broadcastPreview.broadcastId)
      if (scopeRef.current !== startedScope) return
      setBroadcastConfirmOpen(false)
      setBroadcastMessage('')
      setBroadcastPreview(null)
      broadcastPreviewKeyRef.current = null
    } catch {
      if (scopeRef.current !== startedScope) return
      setBroadcastError('送信を開始できませんでした。まだ送られていない可能性があるため、配信一覧で状態を確認してから再試行してください。')
    } finally {
      if (scopeRef.current === startedScope) setBroadcastBusy(false)
    }
  }

  const confirmed = summary?.confirmed ?? 0
  const pending = summary?.requested ?? 0
  const cancelled = summary?.cancelled ?? 0
  /*
   * IDEA-29: 申込・残席・待ち列は人数(席)で数える。旧応答には席数が無い
   * ため、その期間だけ従来の件数を人数として使う(配備の前後で
   * 「取得できません」にせず、値の意味を保つ)。
   */
  const confirmedSeats = summary?.confirmedSeats ?? confirmed
  const requestedSeats = summary?.requestedSeats ?? pending
  const waitingSeats = summary?.waitingSeats ?? null
  const offeredSeats = summary?.offeredSeats ?? null
  const waitlistPeople = waitingSeats !== null && offeredSeats !== null
    ? waitingSeats + offeredSeats
    : (summary?.waitlist ?? 0)
  const applied = confirmedSeats + requestedSeats
  const activeSeats = summary?.activeSeats ?? applied
  const capacity = summary?.totalCapacity ?? 0
  const pageCount = Math.max(1, Math.ceil(bookingsTotal / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const selectedAccountRole = accounts.find((account) => account.id === selectedAccountId)?.role
  const canManageApplicantBroadcast = selectedAccountRole === 'owner' || selectedAccountRole === 'admin'
  const activeBroadcastPreview = broadcastPreview?.scope === scope ? broadcastPreview : null

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
        <Link href="/events" className="text-action ml-3 text-xs hover:underline">
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
          value={dataReady ? applied : null}
          unit="人"
          detail={!dataReady
            ? '取得できませんでした'
            : /*
                IDEA-29: 「申込」の中身を確定と承認待ちに分ける。
                残席は行数ではなく、席を消費中の人数(activeSeats)から
                引く。残り1〜3席の声かけ目安は一覧と同じ基準。
              */
              `確定 ${confirmedSeats}人・承認待ち ${requestedSeats}人 / ${describeBookingCapacity(activeSeats, capacity)}`}
        />
        {/*
          **数の下に「次にすること」を書く。** 「対応が必要」だけだと、
          0件のときも同じ文が出て、**対応するものが有るのか無いのかが
          添え字から読めない。**
        */}
        <EventKpi
          title="承認待ち"
          value={dataReady ? pending : null}
          unit="件"
          detail={dataReady
            ? pending > 0 ? `対応が必要：${pending}件を確認してください` : '確認待ちはありません'
            : '取得できませんでした'}
        />
        {/* 実APIでは別の待ち列だが、画面確認用の応答は同じ一覧に含む。
            行が無いときは設定だけを示し、人数を推測しない。 */}
        <EventKpi
          title="キャンセル待ち"
          value={dataReady ? waitlistPeople : null}
          unit="人"
          /*
            **読めていない設定を言い切らない。** `event` が取れていないと
            `waitlist_enabled` は undefined で、前は必ず「受け付けない設定です」
            と出ていた。**受け付ける設定なのに受け付けないと読める。**
            IDEA-29: 並んでいる人(待機)と案内を送った人(案内中)を分ける。
          */
          detail={!dataReady
            ? '取得できませんでした'
            : waitlistPeople > 0
              ? waitingSeats !== null && offeredSeats !== null
                ? `待機 ${waitingSeats}人・案内中 ${offeredSeats}人`
                : '取り消しが出たら順に案内します'
              : event?.waitlist_enabled ? '空きが出たら順に案内' : '受け付けない設定です'}
        />
        <EventKpi
          title="キャンセル"
          value={dataReady ? cancelled : null}
          unit="件"
          detail={dataReady
            ? cancelled > 0 ? '空いた枠を確認してください' : 'キャンセルはありません'
            : '取得できませんでした'}
        />
      </div>

      <section className="bg-canvas rounded-card border-hairline mb-4 border p-4" aria-labelledby="occurrence-applicants-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="occurrence-applicants-title" className="text-ink font-semibold">開催回ごとの申込者とキャンセル待ち</h3>
            <p className="text-ink-faint mt-1 text-xs">待ち順と案内期限を確認してから、次の方へ案内します。</p>
          </div>
          {occurrenceSlots.length > 0 && (
            <label className="text-ink-secondary grid gap-1 text-xs font-medium">
              開催回
              <SelectField
                aria-label="開催回を選ぶ"
                value={selectedOccurrenceId}
                onChange={(event) => setSelectedOccurrenceId(event.target.value)}
                options={occurrenceSlots.map((slot) => ({ value: slot.id, label: formatJp(slot.starts_at, '日時未取得') }))}
              />
            </label>
          )}
        </div>

        {occurrenceStatus === 'loading' ? (
          <p className="text-ink-faint text-sm">申込者を読み込んでいます…</p>
        ) : occurrenceStatus === 'error' ? (
          <ListState
            kind="error"
            description="申込者は消えていません。開催回を読み直してから、もう一度お試しください。"
            action={<Button onClick={() => void refreshOccurrenceSlots()}>開催回を再読み込み</Button>}
          />
        ) : occurrenceSlots.length === 0 ? (
          <p className="text-ink-faint text-sm">有効な開催回がありません。</p>
        ) : occurrenceApplicants ? (
          <>
            <OccurrenceApplicantsPanel
              data={occurrenceApplicants}
              promoting={promotingWaitlist}
              error={occurrenceActionError}
              onPromote={() => void promoteWaitlist()}
              onExportCsv={() => void exportApplicantsCsv()}
              csvBusy={csvBusy}
            />
            {canManageApplicantBroadcast && (
              <>
                <div className="border-hairline mt-4 border-t pt-4">
                  <h4 className="text-ink font-medium">この開催回の申込者へ一斉送信</h4>
                  <p className="text-ink-faint mt-1 text-xs">対象はこの確認時点の申込者で固定します。確認後の申込・取消・タグ変更では宛先を入れ替えません。</p>
                  <textarea
                    value={broadcastMessage}
                    onChange={(event) => {
                      setBroadcastMessage(event.target.value)
                      setBroadcastPreview(null)
                      setBroadcastError('')
                      broadcastPreviewKeyRef.current = null
                    }}
                    rows={3}
                    maxLength={5000}
                    aria-label="申込者へ送るメッセージ"
                    placeholder="申込者へ送るご案内を書いてください"
                    className="border-hairline rounded-control mt-3 w-full border px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Button onClick={() => void previewOccurrenceBroadcast()} disabled={broadcastBusy || broadcastMessage.trim() === ''}>
                      {broadcastBusy ? '対象を確定中…' : '対象と内容を確認'}
                    </Button>
                    {activeBroadcastPreview && <span className="text-ink-secondary text-sm">送信対象 {activeBroadcastPreview.recipientCount}人</span>}
                    {activeBroadcastPreview && <Button onClick={() => setBroadcastConfirmOpen(true)} disabled={broadcastBusy}>送信前の最終確認へ</Button>}
                  </div>
                  {broadcastError && <p className="text-danger mt-2 text-sm" role="alert">{broadcastError}</p>}
                </div>
                <ConfirmDialog
                  open={broadcastConfirmOpen && activeBroadcastPreview !== null}
                  title="この申込者へ送信を開始しますか？"
                  description={`確認済みの ${activeBroadcastPreview?.recipientCount ?? 0} 人へ送信します。送信開始後は取り消せません。`}
                  confirmLabel="送信を開始"
                  cancelLabel="戻る"
                  busy={broadcastBusy}
                  error={broadcastError}
                  onConfirm={() => void sendOccurrenceBroadcast()}
                  onCancel={() => { if (!broadcastBusy) setBroadcastConfirmOpen(false) }}
                />
              </>
            )}
          </>
        ) : null}
      </section>


        {/*
          操作の失敗は**一覧を消さずに**上に出す。行が消えると、
          どの予約に対して失敗したのかが分からなくなる。
        */}
        {actionError && (
          <Notice tone="danger" message={actionError} onClose={() => setActionError(null)} className="mb-4" />
        )}

        <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <div className="border-hairline flex flex-wrap gap-2 border-b px-4 py-3">
            {STATUS_TABS.map((t) => (
              <FilterChip
                key={t.key}
                selected={tab === t.key}
                onChange={() => {
                  setPage(1)
                  setTab(t.key)
                }}
              >
                {t.label}
              </FilterChip>
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
                        {/* #841: 申込時の質問への回答。質問文はイベントの
                            定義から引き、消えた質問はidのまま出す。 */}
                        {(() => {
                          const raw = b.answer_snapshot_json
                          if (!raw) return null
                          let map: Record<string, unknown>
                          try { map = JSON.parse(raw) } catch { return null }
                          const entries = Object.entries(map)
                          if (entries.length === 0) return null
                          const labelOf = new Map(
                            (eventQuestions ?? []).map((q) => [q.id, q.label]),
                          )
                          return (
                            <dl className="text-ink-faint mt-1 space-y-0.5 text-xs">
                              {entries.map(([qid, ans]) => (
                                <div key={qid}>
                                  <dt className="inline font-medium">{labelOf.get(qid) ?? qid}：</dt>
                                  <dd className="inline">
                                    {Array.isArray(ans) ? ans.join('、') : String(ans)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )
                        })()}
                        {b.customer_note ? (
                          <p className="text-ink-faint mt-1 text-xs">備考：{b.customer_note}</p>
                        ) : null}
                      </td>
                      <td className="text-ink-secondary px-4 py-3 text-xs">
                        {formatJp(b.requested_at ?? b.created_at, '受付日時は未取得')}
                      </td>
                      <td className="text-ink-secondary px-4 py-3">
                        {formatJp(b.slot_starts_at, '予約枠は未取得')}
                        {/* IDEA-07: この予約の通知予定。承認で組まれ、
                            開催回の移動・取消で「停止済み」へ変わる。 */}
                        {(b.reminders ?? []).length > 0 ? (
                          <ul className="text-ink-faint mt-1 space-y-0.5 text-xs" data-booking-reminders={b.id}>
                            {(b.reminders ?? []).map((reminder, index) => (
                              <li key={`${reminder.kind}:${reminder.scheduled_at}:${index}`}>
                                {REMINDER_KIND_LABELS[reminder.kind] ?? 'お知らせ'}
                                {' '}
                                {formatJp(reminder.scheduled_at, '日時未取得')}
                                <span className="ml-1">
                                  {REMINDER_STATUS_LABELS[reminder.status] ?? reminder.status}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
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
                        <StatusBadge tone={statusTone[b.status] ?? 'neutral'}>
                          {STATUS_LABELS.get(b.status) ?? '状態は未取得'}
                        </StatusBadge>
                        {b.status === 'requested' && (
                          <div className="ml-2 inline-flex items-center gap-1.5">
                            <Button
                              onClick={() => decide(b.id, 'confirm')}
                              disabled={busy}
                            >
                              承認
                            </Button>
                            <button
                              type="button"
                              data-qa-open="i5SN2j-reject"
                              onClick={() => {
                                setRejectReason('')
                                setRejectError('')
                                setRejectTarget(b)
                              }}
                              disabled={busy}
                              className="rounded-control px-2 py-1 text-xs font-semibold text-danger hover:underline disabled:opacity-50"
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

export default function EventBookingsPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-4">読み込み中...</div>}>
      <BookingsInner />
    </Suspense>
  )
}
