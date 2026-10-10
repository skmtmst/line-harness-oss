'use client'

/*
 * ★V8 イベント予約の「申込者」（Pencil `Mu8qW`）。
 *
 * 型（DetailPage）に、頭（題・戻る口・CSV・開催回の選び口）、数の帯（申込・承認待ち・キャンセル待ち・キャンセル）、
 * 申込者・キャンセル待ち・キャンセル・お知らせを送る の4枚をはめる。
 * 処理（口・確かめの窓・失敗の文）は今の V8（src/app/events/bookings/bookings-v8.tsx）から写した。
 * 行の操作は絵どおり行に直接出す（承認する／断る・キャンセルにする／参加済／無断・予約に繰上げ・待ち順を変える）。
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Download, Send } from 'lucide-react'
import { api, eventsApi, type EventDetail, type EventOccurrenceApplicant, type EventOccurrenceApplicants, type EventSlot } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { DetailPage } from '@/components/templates'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import StatusBadge from '@/components/shared/status-badge'
import { EventRosterCard, EventRosterTable, EventRosterRow, EventRosterActions, EventAttendanceSummary } from '@/components/shared/event-roster'
import { TextField, TextArea } from '@/components/shared/text-field'
import { CalendarClock, Users, Armchair, CalendarX } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import { jstShort } from './shared'
import styles from './bookings.module.css'

/** 予約・申込の状態の見え方。色だけに頼らず、必ず文字で言う。 */
type ChipTone = 'warning' | 'success' | 'info' | 'neutral' | 'danger'
const STATUS_TONE: Record<string, ChipTone> = {
  requested: 'warning',
  confirmed: 'success',
  waiting: 'neutral',
  offered: 'info',
  accepted: 'success',
  converted: 'success',
  expired: 'neutral',
  cancelled: 'neutral',
  attended: 'success',
  no_show: 'danger',
}

const STATUS_LABELS: Record<string, string> = {
  requested: '承認待ち',
  confirmed: '確定',
  waiting: '待機中',
  offered: '案内中',
  accepted: '受諾済み',
  converted: '予約に繰上げ',
  expired: '期限切れ',
  cancelled: '本人が取消',
  attended: '参加済',
  no_show: '無断',
}

/** 開催回の選び口の表示（板：`10/12（月）14:00`）。曜日は日付から作る。 */
function formatOccurrence(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')}（${get('weekday')}）${get('hour')}:${get('minute')}`
}

function participationSub(applicant: EventOccurrenceApplicant): string {
  if (applicant.firstParticipation.isFirst === true) return '初参加'
  if (applicant.firstParticipation.isFirst === false) return '過去のイベント参加あり'
  return ''
}

type WaitlistDialog =
  | { kind: 'promote' }
  | { kind: 'reorder'; applicantId: string; direction: -1 | 1; description: string }
  | { kind: 'skip'; waitlistId: string; name: string }

export default function EventBookingsV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <BookingsEntry />
    </Suspense>
  )
}

function BookingsEntry() {
  const eventId = useSearchParams().get('id') ?? ''
  return <Bookings eventId={eventId} />
}

function Bookings({ eventId }: { eventId: string }) {
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [eventStatus, setEventStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [slotsStatus, setSlotsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [slots, setSlots] = useState<EventSlot[]>([])
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState('')
  const [applicants, setApplicants] = useState<EventOccurrenceApplicants | null>(null)
  const [applicantsStatus, setApplicantsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set())
  const [csvBusy, setCsvBusy] = useState(false)
  const [cancelApplicant, setCancelApplicant] = useState<{ applicant: EventOccurrenceApplicant; accountId: string } | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [rejectApplicant, setRejectApplicant] = useState<EventOccurrenceApplicant | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [waitlistDialog, setWaitlistDialog] = useState<WaitlistDialog | null>(null)
  const [waitlistReason, setWaitlistReason] = useState('')
  const [waitlistBusy, setWaitlistBusy] = useState(false)
  const [waitlistError, setWaitlistError] = useState('')
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastPreview, setBroadcastPreview] = useState<{ broadcastId: string; recipientCount: number } | null>(null)
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false)
  const [broadcastBusy, setBroadcastBusy] = useState(false)
  const [broadcastError, setBroadcastError] = useState('')
  const requestRef = useRef(0)

  usePageTitle(event?.name ? `${event.name} の申込者` : 'イベントの申込者')

  const scope = JSON.stringify([selectedAccountId, eventId])

  const refreshEvent = useCallback(async () => {
    if (!selectedAccountId) return
    setEventStatus('loading')
    try {
      const detail = await eventsApi.getEvent(selectedAccountId, eventId)
      setEvent(detail)
      setEventStatus('ready')
    } catch {
      setEvent(null)
      setEventStatus('error')
    }
  }, [selectedAccountId, eventId])

  const refreshSlots = useCallback(async () => {
    setSlotsStatus('loading')
    if (!selectedAccountId) {
      setSlots([])
      setSelectedOccurrenceId('')
      return
    }
    try {
      const res = await eventsApi.listOccurrenceSelector(selectedAccountId, eventId)
      setSlots(res.items)
      setSlotsStatus('ready')
      setSelectedOccurrenceId((current) => current || res.items[0]?.id || '')
    } catch {
      setSlots([])
      setSlotsStatus('error')
    }
  }, [selectedAccountId, eventId])

  const refreshApplicants = useCallback(async () => {
    if (!selectedAccountId || !selectedOccurrenceId) return
    const requestId = ++requestRef.current
    const startedScope = scope
    setApplicantsStatus('loading')
    setActionError('')
    try {
      const data = await eventsApi.getOccurrenceApplicants(selectedAccountId, selectedOccurrenceId)
      if (requestId !== requestRef.current || scope !== startedScope) return
      setApplicants(data)
      setBroadcastPreview(null)
      setBroadcastConfirmOpen(false)
      setApplicantsStatus('ready')
    } catch {
      if (requestId !== requestRef.current || scope !== startedScope) return
      setApplicants(null)
      setApplicantsStatus('error')
    }
  }, [selectedAccountId, selectedOccurrenceId, scope])

  useEffect(() => {
    void refreshEvent()
    setApplicants(null)
    setSelectedOccurrenceId('')
    void refreshSlots()
  }, [refreshEvent, refreshSlots])

  useEffect(() => {
    if (!selectedOccurrenceId) return
    void refreshApplicants()
  }, [refreshApplicants, selectedOccurrenceId])

  if (!eventId) {
    return (
      <div data-design-node="Mu8qW">
        <TargetMissing
          kind="unspecified"
          title="どのイベントの申込かが決まっていません"
          description="イベントの一覧から選び直してください。"
          backHref="/events"
          backLabel="イベント一覧へ戻る"
        />
      </div>
    )
  }

  if (!selectedAccountId) {
    return (
      <div data-design-node="Mu8qW">
        <ListState kind="empty" title="LINEアカウントを選択してください" description="上のバーで運用するLINEアカウントを選んでください。" />
      </div>
    )
  }

  const occurrence = applicants?.occurrence ?? null
  const rows = applicants?.applicants ?? []
  const bookingRows = rows.filter((row) => row.source === 'booking')
  const waitingRows = rows.filter((row) => row.source === 'waitlist' && row.status === 'waiting')
  const summary = applicants?.summary
  const confirmedSeats = summary?.confirmedSeats ?? bookingRows.filter((row) => row.status === 'confirmed').reduce((total, row) => total + row.partySize, 0)
  const requestedSeats = summary?.requestedSeats ?? bookingRows.filter((row) => row.status === 'requested').reduce((total, row) => total + row.partySize, 0)
  const waitingSeats = summary?.waitingSeats ?? waitingRows.reduce((total, row) => total + row.partySize, 0)
  const offeredSeats = summary?.offeredSeats ?? 0
  const capacity = occurrence?.capacity ?? null
  const history = applicants?.waitlistHistory ?? []
  const cancelledCount = history.filter((entry) => entry.status === 'cancelled').length
  const attendance = applicants?.attendance ?? null
  /* お知らせの口は統括・管理者だけ（Worker の requireRole('owner','admin')）。役割はサーバーから読む。 */
  const canBroadcast = staffRole === 'owner' || staffRole === 'admin'

  async function decide(applicant: EventOccurrenceApplicant, action: 'confirm' | 'reject') {
    if (!selectedAccountId || busy) return
    setBusy(true)
    try {
      await eventsApi.decideBooking(selectedAccountId, eventId, applicant.id, action, action === 'reject' ? rejectReason.trim() || undefined : undefined)
      if (action === 'reject') {
        setRejectApplicant(null)
        setRejectReason('')
        setRejectError('')
      }
      await refreshApplicants()
    } catch {
      if (action === 'reject') {
        setRejectError('予約を拒否できませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。')
      } else {
        setActionError('予約を確定できませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。')
      }
    } finally {
      setBusy(false)
    }
  }

  async function runAdminCancel() {
    if (!cancelApplicant || cancelling) return
    if (cancelApplicant.accountId !== selectedAccountId) return
    setCancelling(true)
    setCancelError('')
    try {
      const res = await eventsApi.adminCancelBooking(cancelApplicant.accountId, eventId, cancelApplicant.applicant.id)
      if (!res?.ok) throw new Error('cancel_not_applied')
      setCancelApplicant(null)
      await refreshApplicants()
    } catch {
      setCancelError('この予約をキャンセルできませんでした。ほかの操作で状態が変わっている場合があります。一覧を読み直してから、もう一度お試しください。')
    } finally {
      setCancelling(false)
    }
  }

  async function markStatus(applicant: EventOccurrenceApplicant, status: 'attended' | 'no_show') {
    const accountId = selectedAccountId
    if (!accountId || marking.has(applicant.id)) return
    setMarking((current) => new Set(current).add(applicant.id))
    try {
      await eventsApi.updateBooking(accountId, eventId, applicant.id, { status })
      await refreshApplicants()
    } catch {
      setActionError('来場・不参加の記録を変えられませんでした。一覧を読み直してから、もう一度お試しください。')
    } finally {
      setMarking((current) => {
        const next = new Set(current)
        next.delete(applicant.id)
        return next
      })
    }
  }

  function openReorder(applicantId: string, direction: -1 | 1) {
    const waiting = rows.filter((row) => row.source === 'waitlist' && row.status === 'waiting')
    const index = waiting.findIndex((row) => row.id === applicantId)
    const other = waiting[index + direction]
    const current = waiting[index]
    if (!current || !other) return
    const first = direction === -1 ? current : other
    const second = direction === -1 ? other : current
    setWaitlistReason('')
    setWaitlistError('')
    setWaitlistDialog({
      kind: 'reorder',
      applicantId,
      direction,
      description: `「${first.displayName ?? '待機中の方'}」と「${second.displayName ?? '待機中の方'}」の順番を入れ替えます。`,
    })
  }

  async function runWaitlistOperation() {
    if (!selectedAccountId || !occurrence || !waitlistDialog || waitlistBusy) return
    const trimmed = waitlistReason.trim()
    if (trimmed === '') return
    setWaitlistBusy(true)
    setWaitlistError('')
    setActionError('')
    try {
      if (waitlistDialog.kind === 'promote') {
        await eventsApi.promoteOccurrenceWaitlist(selectedAccountId, occurrence.id, occurrence.version, trimmed)
      } else if (waitlistDialog.kind === 'reorder') {
        const waiting = rows.filter((row) => row.source === 'waitlist' && row.status === 'waiting')
        const index = waiting.findIndex((row) => row.id === waitlistDialog.applicantId)
        const orderedIds = waiting.map((row) => row.id)
        const [moved] = orderedIds.splice(index, 1)
        orderedIds.splice(index + waitlistDialog.direction, 0, moved as string)
        await eventsApi.reorderOccurrenceWaitlist(selectedAccountId, occurrence.id, {
          ordered_ids: orderedIds,
          expectedVersion: occurrence.version,
          reason: trimmed,
        })
      } else {
        await eventsApi.skipOccurrenceWaitlist(selectedAccountId, occurrence.id, {
          waitlist_id: waitlistDialog.waitlistId,
          expectedVersion: occurrence.version,
          reason: trimmed,
        })
      }
      setWaitlistDialog(null)
      setWaitlistReason('')
      await refreshApplicants()
    } catch {
      await refreshApplicants()
      setWaitlistError('変えられませんでした。ほかの操作で順番や空席が変わった可能性があります。最新の状態を確かめてから、もう一度お試しください。')
    } finally {
      setWaitlistBusy(false)
    }
  }

  async function exportCsv() {
    if (!selectedAccountId || !applicants || csvBusy) return
    setCsvBusy(true)
    setActionError('')
    try {
      await eventsApi.downloadOccurrenceApplicantsCsv(selectedAccountId, applicants.occurrence.id, applicants.snapshotId)
    } catch {
      setActionError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setCsvBusy(false)
    }
  }

  async function previewBroadcast() {
    const message = broadcastMessage.trim()
    if (!selectedAccountId || !occurrence || !message || broadcastBusy) return
    setBroadcastBusy(true)
    setBroadcastError('')
    try {
      const result = await eventsApi.previewOccurrenceBroadcast(selectedAccountId, occurrence.id, {
        title: `${event?.name ?? 'イベント'}の申込者への案内`,
        messageContent: message,
        snapshotId: applicants?.snapshotId ?? '',
      }, crypto.randomUUID())
      setBroadcastPreview({ broadcastId: result.broadcastId, recipientCount: result.recipientCount })
      setBroadcastConfirmOpen(true)
    } catch {
      setBroadcastError('対象を確定できませんでした。内容を確認して、もう一度お試しください。')
    } finally {
      setBroadcastBusy(false)
    }
  }

  async function sendBroadcast() {
    if (!broadcastPreview || broadcastBusy) return
    setBroadcastBusy(true)
    setBroadcastError('')
    try {
      await api.broadcasts.send(broadcastPreview.broadcastId)
      setBroadcastConfirmOpen(false)
      setBroadcastMessage('')
      setBroadcastPreview(null)
    } catch {
      setBroadcastError('送信を開始できませんでした。まだ送られていない可能性があるため、配信一覧で状態を確認してから再試行してください。')
    } finally {
      setBroadcastBusy(false)
    }
  }

  /* 区分・順位の「キャンセル待ち N 番」は、案内中も含めた並び順で数える（絵：案内中 1 番・待機中 2 番）。 */
  const queueRows = rows.filter((row) => row.source === 'waitlist' && (row.status === 'waiting' || row.status === 'offered' || row.status === 'accepted'))
  const waitlistRankAll = (id: string) => queueRows.findIndex((row) => row.id === id) + 1

  const chip = (status: string) => {
    const label = STATUS_LABELS[status] ?? status
    return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{label}</StatusBadge>
  }
  const historyRows = history.filter((entry) => entry.status !== 'cancelled')
  const cancelRows = history.filter((entry) => entry.status === 'cancelled')
  const title = event?.name ? `${event.name}の申込者` : 'イベントの申込者'
  const subLine = [event?.venue_name ?? null, capacity !== null ? `定員 ${capacity} 人` : null].filter(Boolean).join(' ・ ')
  const ready = applicantsStatus === 'ready'

  return (
    <DetailPage
      boardId="Mu8qW"
      title={title}
      layout="event-roster"
      help={subLine || '開催回ごとの申込・承認・キャンセル待ちを確認できます。'}
      contentPadding="var(--tpl-roster-body-pad)"
      stats={<KpiBand>
        <KpiCard icon={<CalendarClock size={13} />} title="開催回" value={slotsStatus === 'ready' ? slots.length : null} unit="回" detail="このイベントの回" />
        <KpiCard icon={<Users size={13} />} title="全回の申込" value={slotsStatus === 'ready' && slots.every((slot) => typeof slot.active_count === 'number') ? slots.reduce((sum, slot) => sum + slot.active_count!, 0) : null} unit="人" detail="全開催回の合計" />
        <KpiCard icon={<Armchair size={13} />} title="全回の定員" value={slotsStatus === 'ready' && slots.every((slot) => slot.capacity !== null) ? slots.reduce((sum, slot) => sum + slot.capacity!, 0) : null} unit="人" detail="定員なしの回があるときは —" />
        <KpiCard icon={<CalendarX size={13} />} title="取消期限" value={event?.cancel_deadline_hours_before} unit="時間前" detail="開始時刻から数えます" />
      </KpiBand>}
      actions={(
        <div className={styles.headActions}>
          <Button onClick={() => void exportCsv()} disabled={csvBusy || !applicants} busy={csvBusy} busyLabel="書き出しています…">
            <Download size={15} aria-hidden="true" />CSV を書き出す
          </Button>
          <div className={styles.occurrencePick}>
            <Select
              size="full"
              value={selectedOccurrenceId}
              onChange={setSelectedOccurrenceId}
              aria-label="開催回を選ぶ"
              options={slots.map((slot) => ({ value: slot.id, label: `開催回：${formatOccurrence(slot.starts_at)}` }))}
            />
          </div>
        </div>
      )}
    >
      <div className={styles.body}>
      {eventStatus === 'error' ? (
        <ListState
          kind="error"
          description="イベントは消えていません。開き直しても直らない場合はエラー報告へ。"
          action={<Button onClick={() => void refreshEvent()}>開き直す</Button>}
        />
      ) : null}
      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}

      {/* 数の帯。絵（Mu8qW）は4枚のカードなので、共通の KpiCard をカードの見せ方で並べる。 */}
      <KpiBand data-design="KPIs">
        <KpiCard presentation="band" title="申込" icon={<Users size={13} />} value={ready ? (occurrence?.activeSeats ?? confirmedSeats + requestedSeats) : null} valueText={ready ? `${occurrence?.activeSeats ?? confirmedSeats + requestedSeats}${capacity !== null ? ` / ${capacity}` : ''}` : undefined} valueTextWithUnit unit="人・この回" detail="" />
        <KpiCard presentation="band" title="承認待ち" icon={<CalendarClock size={13} />} value={ready ? requestedSeats : null} unit="件" detail="" />
        <KpiCard presentation="band" title="キャンセル待ち" icon={<Armchair size={13} />} value={ready ? waitingSeats + offeredSeats : null} unit="人" detail="" />
        <KpiCard presentation="band" title="キャンセル" icon={<CalendarX size={13} />} value={ready ? cancelledCount : null} unit="件" detail="" />
      </KpiBand>

      <EventRosterCard title="申込者" id="ev-bk-applicants" splitAction
        note="承認待ちは期限までに承認か断るを選びます。断る・キャンセルにすると LINE でお知らせが届き、枠が空きます"
        action={<EventAttendanceSummary
          attended={ready ? attendance?.attendedSeats ?? null : null}
          noShow={ready ? attendance?.noShowSeats ?? null : null}
          before={ready && attendance ? Math.max(0, confirmedSeats - attendance.attendedSeats - attendance.noShowSeats) : null}
        />}>
        {applicantsStatus === 'loading' ? <ListState kind="loading" /> : applicantsStatus === 'error' ? (
          <ListState
            kind="error"
            description="申込者は消えていません。開き直しても直らない場合はエラー報告へ。"
            action={<Button onClick={() => void refreshApplicants()}>開き直す</Button>}
          />
        ) : rows.length === 0 ? (
          <p className={styles.empty}>この開催回には申込者もキャンセル待ちもいません。</p>
        ) : (
          <EventRosterTable kind="applicants" label="申込者" headings={["申込者", "区分・順位", "状態", "案内期限"]}>
            {rows.map((row) => (
              <EventRosterRow key={`${row.source}:${row.id}`}>
                <span role="cell" className={styles.person}>
                  <span className={styles.personName} title={row.displayName ?? '友だちは未取得'}>{row.displayName ?? '友だちは未取得'}</span>
                  <span className={styles.personSub} title={participationSub(row)}>{participationSub(row)}</span>
                </span>
                <span role="cell" className={styles.cellText} title={row.source === 'waitlist' ? `キャンセル待ち ${waitlistRankAll(row.id)} 番` : '申込'}>
                  {row.source === 'waitlist'
                    ? row.status === 'waiting' || row.status === 'offered' || row.status === 'accepted'
                      ? `キャンセル待ち ${waitlistRankAll(row.id)} 番`
                      : 'キャンセル待ち'
                    : '申込'}
                </span>
                <span role="cell">{chip(row.status)}</span>
                <EventRosterActions deadline={<span title={row.offerExpiresAt ? jstShort(row.offerExpiresAt) : undefined}>
                  {row.offerExpiresAt ? jstShort(row.offerExpiresAt) : row.status === 'waiting' ? '案内前' : '—'}
                </span>}>
                  {row.source === 'booking' && row.status === 'requested' ? (
                    <>
                      <Button onClick={() => void decide(row, 'confirm')} disabled={busy}>承認する</Button>
                      <Button
                        onClick={() => {
                          setRejectReason('')
                          setRejectError('')
                          setRejectApplicant(row)
                        }}
                        disabled={busy}
                      >断る</Button>
                    </>
                  ) : null}
                  {row.source === 'booking' && row.status === 'confirmed' ? (
                    <>
                      <Button
                        onClick={() => {
                          if (!selectedAccountId) return
                          setCancelError('')
                          setCancelApplicant({ applicant: row, accountId: selectedAccountId })
                        }}
                        disabled={busy}
                      >キャンセルにする</Button>
                      <Button onClick={() => void markStatus(row, 'attended')} disabled={marking.has(row.id)}><Check size={15} aria-hidden="true" />参加済</Button>
                      <Button onClick={() => void markStatus(row, 'no_show')} disabled={marking.has(row.id)}>無断</Button>
                    </>
                  ) : null}
                  {row.source === 'waitlist' && (row.status === 'offered' || row.status === 'accepted') ? (
                    <Button
                      onClick={() => {
                        setWaitlistReason('')
                        setWaitlistError('')
                        setWaitlistDialog({ kind: 'promote' })
                      }}
                      disabled={waitlistBusy}
                    >予約に繰上げ</Button>
                  ) : null}
                  {row.source === 'waitlist' && row.status === 'waiting' ? (
                    <Button
                      onClick={() => {
                        setWaitlistReason('')
                        setWaitlistError('')
                        const index = waitingRows.findIndex((waiting) => waiting.id === row.id)
                        openReorder(row.id, index <= 0 ? 1 : -1)
                      }}
                      disabled={waitlistBusy || waitingRows.length < 2}
                      title={waitingRows.length < 2 ? '並んでいる人が2人以上いるときに使えます' : undefined}
                    >待ち順を変える</Button>
                  ) : null}
                </EventRosterActions>
              </EventRosterRow>
            ))}
          </EventRosterTable>
        )}
      </EventRosterCard>

      <EventRosterCard title="キャンセル待ち" id="ev-bk-waitlist" note="空きが出たら先頭の方へ期限つきの案内を送ります。期限までに返事がなければ次の方へ" action={(
          <Button
            onClick={() => {
              setWaitlistReason('')
              setWaitlistError('')
              setWaitlistDialog({ kind: 'promote' })
            }}
            disabled={waitlistBusy || waitingRows.length === 0}
          >
            <Send size={15} aria-hidden="true" />次の方へ案内する
          </Button>
        )}>
        <EventRosterTable kind="waitlist" label="キャンセル待ち" headings={["友だち", "結果", "並んだ日時", "案内日時", "終了日時"]}>
          {rows.filter((row) => row.source === 'waitlist').map((row) => (
            <EventRosterRow key={`now:${row.id}`}>
              <span role="cell" className={styles.cellName} title={row.displayName ?? '友だちは未取得'}>{row.displayName ?? '友だちは未取得'}</span>
              <span role="cell">{chip(row.status)}</span>
              <span role="cell" className={styles.cellText}>{jstShort(row.appliedAt)}</span>
              <span role="cell" className={styles.cellText}>{jstShort(row.offeredAt)}</span>
              <span role="cell" className={styles.cellText}>—</span>
            </EventRosterRow>
          ))}
          {historyRows.map((entry) => (
            <EventRosterRow key={`done:${entry.id}`}>
              <span role="cell" className={styles.cellName} title={entry.displayName ?? '友だちは未取得'}>{entry.displayName ?? '友だちは未取得'}</span>
              <span role="cell">{chip(entry.status)}</span>
              <span role="cell" className={styles.cellText}>{jstShort(entry.createdAt)}</span>
              <span role="cell" className={styles.cellText}>{jstShort(entry.offeredAt)}</span>
              <span role="cell" className={styles.cellText}>{jstShort(entry.updatedAt)}</span>
            </EventRosterRow>
          ))}
          {waitingRows.length === 0 && historyRows.length === 0 && !rows.some((row) => row.source === 'waitlist') ? (
            <p className={styles.empty}>キャンセル待ちはいません。</p>
          ) : null}
        </EventRosterTable>
      </EventRosterCard>

      <EventRosterCard title="キャンセル" id="ev-bk-cancel">
        <EventRosterTable kind="cancel" label="キャンセル" headings={["友だち", "結果", "記録日時"]}>
          {cancelRows.map((entry) => (
            <EventRosterRow key={entry.id}>
              <span role="cell" className={styles.cellName} title={entry.displayName ?? '友だちは未取得'}>{entry.displayName ?? '友だちは未取得'}</span>
              <span role="cell">{chip('cancelled')}</span>
              <span role="cell" className={styles.cellText}>{jstShort(entry.updatedAt)}</span>
            </EventRosterRow>
          ))}
          {cancelRows.length === 0 ? <p className={styles.empty}>キャンセルはありません。</p> : null}
        </EventRosterTable>
      </EventRosterCard>

      {canBroadcast ? (
        <EventRosterCard title="お知らせを送る" id="ev-bk-broadcast" note="この回の申込者へ LINE でまとめて送ります（送ったお知らせは取り消せません）">
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ev-bk-message">申込者へ送るメッセージ</label>
            <div className={styles.broadcastRow}>
              <TextField
                className={styles.messageInput}
                id="ev-bk-message"
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="当日は動きやすい服装でお越しください"
              />
              <Button onClick={() => void previewBroadcast()} disabled={broadcastBusy || broadcastMessage.trim() === ''} aria-busy={broadcastBusy || undefined}>
                {broadcastBusy ? '確認中…' : '送る'}
              </Button>
            </div>
          </div>
          {broadcastError ? <p className={styles.error} role="alert">{broadcastError}</p> : null}
        </EventRosterCard>
      ) : null}
      </div>

      <ConfirmDialog
        open={cancelApplicant !== null}
        destructive
        title={`「${cancelApplicant?.applicant.displayName ?? '友だちは未取得'}」の予約をキャンセルしますか？`}
        description="友だちへLINEでお知らせが届き、枠が空きます。空いた枠はキャンセル待ちの方へ回ります。この操作は元に戻せません。"
        confirmLabel="キャンセルする"
        busy={cancelling}
        error={cancelError}
        onConfirm={() => void runAdminCancel()}
        onCancel={() => {
          if (cancelling) return
          setCancelError('')
          setCancelApplicant(null)
        }}
      />

      <ConfirmDialog
        open={rejectApplicant !== null}
        destructive
        title={`「${rejectApplicant?.displayName ?? '友だちは未取得'}」の申込を断りますか？`}
        description="理由は内部にだけ残り、友だちには送りません。断ると枠が空きます。"
        confirmLabel="断る"
        busy={busy}
        error={rejectError}
        onConfirm={() => rejectApplicant && void decide(rejectApplicant, 'reject')}
        onCancel={() => {
          if (busy) return
          setRejectError('')
          setRejectReason('')
          setRejectApplicant(null)
        }}
      >
        {rejectApplicant ? (
          <label className={styles.dialogLabel}>
            断る理由（任意・内部メモ）
            <TextArea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}

            />
          </label>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={waitlistDialog !== null}
        title={
          waitlistDialog?.kind === 'promote'
            ? '次の方へ案内しますか？'
            : waitlistDialog?.kind === 'reorder'
              ? '待ち順を変えますか？'
              : '最後尾へ回しますか？'
        }
        description={
          waitlistDialog?.kind === 'promote'
            ? '先頭の方へ期限つきの案内を送ります。理由は変更の記録に残ります。'
            : waitlistDialog?.kind === 'reorder'
              ? `${waitlistDialog.description}理由は変更の記録に残ります。`
              : '行は消さず、次回の案内では後回しになります。理由は変更の記録に残ります。'
        }
        confirmLabel={waitlistDialog?.kind === 'reorder' ? '入れ替える' : '実行する'}
        busy={waitlistBusy}
        error={waitlistError}
        onConfirm={() => void runWaitlistOperation()}
        onCancel={() => {
          if (waitlistBusy) return
          setWaitlistError('')
          setWaitlistReason('')
          setWaitlistDialog(null)
        }}
      >
        {waitlistDialog ? (
          <>
            {waitlistDialog.kind === 'reorder' ? (
              <div className={styles.dialogButtons}>
                <Button
                  size="compact"
                  onClick={() => {
                    const waiting = rows.filter((row) => row.source === 'waitlist' && row.status === 'waiting')
                    const index = waiting.findIndex((row) => row.id === waitlistDialog.applicantId)
                    const other = waiting[index - 1]
                    const current = waiting[index]
                    if (current && other) {
                      setWaitlistDialog({
                        kind: 'reorder',
                        applicantId: waitlistDialog.applicantId,
                        direction: -1,
                        description: `「${current.displayName ?? '待機中の方'}」と「${other.displayName ?? '待機中の方'}」の順番を入れ替えます。`,
                      })
                    }
                  }}
                >
                  上へ
                </Button>
                <Button
                  size="compact"
                  onClick={() => {
                    const waiting = rows.filter((row) => row.source === 'waitlist' && row.status === 'waiting')
                    const index = waiting.findIndex((row) => row.id === waitlistDialog.applicantId)
                    const other = waiting[index + 1]
                    const current = waiting[index]
                    if (current && other) {
                      setWaitlistDialog({
                        kind: 'reorder',
                        applicantId: waitlistDialog.applicantId,
                        direction: 1,
                        description: `「${current.displayName ?? '待機中の方'}」と「${other.displayName ?? '待機中の方'}」の順番を入れ替えます。`,
                      })
                    }
                  }}
                >
                  下へ
                </Button>
              </div>
            ) : null}
            <label className={styles.dialogLabel}>
              理由（必須・記録に残ります）
              <TextArea
                value={waitlistReason}
                onChange={(e) => setWaitlistReason(e.target.value)}
                rows={2}

              />
            </label>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={broadcastConfirmOpen && broadcastPreview !== null}
        title={`${broadcastPreview?.recipientCount ?? 0}人に送りますか？`}
        description="この回の申込者へLINEでまとめて送ります。送ったお知らせは取り消せません。"
        confirmLabel="送る"
        busy={broadcastBusy}
        error={broadcastError}
        onConfirm={() => void sendBroadcast()}
        onCancel={() => {
          if (broadcastBusy) return
          setBroadcastError('')
          setBroadcastConfirmOpen(false)
        }}
      />
    </DetailPage>
  )
}
