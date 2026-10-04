'use client'

/*
 * ★V8-B イベント予約の「申込者」（板 `Mu8qW`）。
 *
 * v7 の申込者（`page.tsx` の EventBookingsPageV7）とは別の部品として持つ。
 * 同じ口（開催回の選択・承認と拒否・キャンセル・受付の記録・待ちの操作・
 * CSV・お知らせ）で、開催回ごとの見せ方にする。
 * イベント全体の状態タブの一覧は v7 に残す（V8 完成までの二重管理）。
 *
 * 行の操作は板どおり行に直接出す（承認する／断る・キャンセルにする／
 * 参加済／無断・予約に繰上げ・待ち順を変える）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api, eventsApi, type EventDetail, type EventOccurrenceApplicant, type EventOccurrenceApplicants, type EventSlot } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { formatDateTime } from '@/lib/format'
import styles from './bookings-v8.module.css'

/** 予約・申込の状態の見え方。色だけに頼らず、必ず文字で言う。 */
const STATUS_TONE: Record<string, StatusBadgeTone> = {
  requested: 'warning',
  confirmed: 'success',
  waiting: 'warning',
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

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function formatJp(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return fallback
  return formatDateTime(date)
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

export default function BookingsV8({ eventId }: { eventId: string }) {
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [eventStatus, setEventStatus] = useState<'loading' | 'ready' | 'error'>('loading')
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
    if (!selectedAccountId) {
      setSlots([])
      setSelectedOccurrenceId('')
      return
    }
    try {
      const res = await eventsApi.listOccurrenceSelector(selectedAccountId, eventId)
      setSlots(res.items)
      setSelectedOccurrenceId((current) => current || res.items[0]?.id || '')
    } catch {
      setSlots([])
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
      <div className={styles.board} data-design-node="Mu8qW">
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
      <div className={styles.board} data-design-node="Mu8qW">
        <ListState kind="empty" title="LINEアカウントを選択してください" description="サイドバーで運用するLINEアカウントを選んでください。" />
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
  const selectedRole = accounts.find((account) => account.id === selectedAccountId)?.role
  const canBroadcast = selectedRole === 'owner' || selectedRole === 'admin'

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

  const waitlistRank = (id: string) => waitingRows.findIndex((row) => row.id === id) + 1

  return (
    <div className={styles.board} data-design-node="Mu8qW">
      <div className={styles.head}>
        <div>
          <h2 className={styles.headTitle}>{event?.name ?? 'イベントの申込者'} の申込者</h2>
          <p className={styles.headSub}>
            <Link href="/events" className="text-action hover:underline">← イベント予約へ</Link>
            {event?.venue_name ? `・${event.venue_name}` : ''}
            {capacity !== null ? `・定員 ${capacity}人` : ''}
          </p>
        </div>
        <div className={styles.headActions}>
          <Button variant="secondary" onClick={() => void exportCsv()} disabled={csvBusy || !applicants}>
            {csvBusy ? '書き出しています…' : 'CSVで書き出す'}
          </Button>
          <Select
            value={selectedOccurrenceId}
            onChange={setSelectedOccurrenceId}
            aria-label="開催回を選ぶ"
            options={slots.map((slot) => ({ value: slot.id, label: `開催回：${formatOccurrence(slot.starts_at)}` }))}
          />
        </div>
      </div>

      {eventStatus === 'error' ? (
        <ListState
          kind="error"
          description="イベントは消えていません。開き直しても直らない場合はエラー報告へ。"
          action={<Button onClick={() => void refreshEvent()}>開き直す</Button>}
        />
      ) : null}
      {actionError ? <p className="text-danger text-sm" role="alert">{actionError}</p> : null}

      <div className={styles.kpis} data-design="KPIs">
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>申込</span>
          <span className={styles.kpiValue}>
            {applicantsStatus === 'ready' ? (occurrence?.activeSeats ?? confirmedSeats + requestedSeats) : '—'}
            {capacity !== null ? <span className={styles.kpiUnit}> / {capacity}</span> : null}
          </span>
          <span className={styles.kpiDetail}>人・この回</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>承認待ち</span>
          <span className={requestedSeats > 0 ? `${styles.kpiValue} ${styles.kpiValueWarn}` : styles.kpiValue}>{applicantsStatus === 'ready' ? requestedSeats : '—'}</span>
          <span className={styles.kpiDetail}>件</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>キャンセル待ち</span>
          <span className={styles.kpiValue}>{applicantsStatus === 'ready' ? waitingSeats + offeredSeats : '—'}</span>
          <span className={styles.kpiDetail}>人</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>キャンセル</span>
          <span className={styles.kpiValue}>{applicantsStatus === 'ready' ? cancelledCount : '—'}</span>
          <span className={styles.kpiDetail}>件</span>
        </div>
      </div>

      <section className={styles.section} aria-label="申込者">
        <div className={styles.sectionHead}>
          <div>
            <h3 className={styles.sectionTitle}>申込者</h3>
            <p className={styles.sectionNote}>
              承認待ちは期限までに承認か断るを選びます。断る・キャンセルにするとLINEでお知らせが届き、枠が空きます
            </p>
          </div>
        </div>
        <div className={styles.attendanceBox}>
          参加済 {attendance?.attendedSeats ?? 0}人　無断欠席 {attendance?.noShowSeats ?? 0}人　受付前 {confirmedSeats}人
          当日、来た人に「参加済」、来なかった人に「無断」を付けます
        </div>
        {applicantsStatus === 'loading' ? <ListState kind="loading" /> : applicantsStatus === 'error' ? (
          <ListState
            kind="error"
            description="申込者は消えていません。開き直しても直らない場合はエラー報告へ。"
            action={<Button onClick={() => void refreshApplicants()}>開き直す</Button>}
          />
        ) : rows.length === 0 ? (
          <p className="text-ink-faint py-4 text-sm">この開催回には申込者もキャンセル待ちもいません。</p>
        ) : (
          <div className={styles.tableScroll}>
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th style={{ width: '24%' }}>申込者</Th>
                  <Th style={{ width: '20%' }}>区分・順位</Th>
                  <Th style={{ width: '14%' }}>状態</Th>
                  <Th style={{ width: '16%' }}>案内期限</Th>
                  <Th align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={`${row.source}:${row.id}`}>
                    <Td>
                      <span className="text-ink block truncate text-sm font-medium" title={row.displayName ?? '友だちは未取得'}>
                        {row.displayName ?? '友だちは未取得'}
                      </span>
                      <span className={styles.personSub}>{participationSub(row)}</span>
                    </Td>
                    <Td className="text-sm">
                      {row.source === 'waitlist'
                        ? row.status === 'waiting'
                          ? `キャンセル待ち ${waitlistRank(row.id)}番`
                          : 'キャンセル待ち'
                        : '申込'}
                    </Td>
                    <Td>
                      <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'} size="compact">
                        {STATUS_LABELS[row.status] ?? row.status}
                      </StatusBadge>
                    </Td>
                    <Td className="text-xs">
                      {row.offerExpiresAt
                        ? formatJp(row.offerExpiresAt, '期限は未取得')
                        : row.status === 'waiting'
                          ? '案内前'
                          : '—'}
                    </Td>
                    <Td align="right">
                      <span className={styles.rowActions}>
                        {row.source === 'booking' && row.status === 'requested' ? (
                          <>
                            <Button variant="secondary" size="compact" onClick={() => void decide(row, 'confirm')} disabled={busy}>
                              承認する
                            </Button>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => {
                                setRejectReason('')
                                setRejectError('')
                                setRejectApplicant(row)
                              }}
                              disabled={busy}
                            >
                              断る
                            </Button>
                          </>
                        ) : null}
                        {row.source === 'booking' && row.status === 'confirmed' ? (
                          <>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => {
                                if (!selectedAccountId) return
                                setCancelError('')
                                setCancelApplicant({ applicant: row, accountId: selectedAccountId })
                              }}
                              disabled={busy}
                            >
                              キャンセルにする
                            </Button>
                            <Button variant="secondary" size="compact" onClick={() => void markStatus(row, 'attended')} disabled={marking.has(row.id)}>
                              ✓ 参加済
                            </Button>
                            <Button variant="secondary" size="compact" onClick={() => void markStatus(row, 'no_show')} disabled={marking.has(row.id)}>
                              無断
                            </Button>
                          </>
                        ) : null}
                        {row.source === 'waitlist' && (row.status === 'offered' || row.status === 'accepted') ? (
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => {
                              setWaitlistReason('')
                              setWaitlistError('')
                              setWaitlistDialog({ kind: 'promote' })
                            }}
                            disabled={waitlistBusy}
                          >
                            予約に繰上げ
                          </Button>
                        ) : null}
                        {row.source === 'waitlist' && row.status === 'waiting' ? (
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => {
                              setWaitlistReason('')
                              setWaitlistError('')
                              const index = waitingRows.findIndex((waiting) => waiting.id === row.id)
                              openReorder(row.id, index <= 0 ? 1 : -1)
                            }}
                            disabled={waitlistBusy || waitingRows.length < 2}
                            title={waitingRows.length < 2 ? '並んでいる人が2人以上いるときに使えます' : undefined}
                          >
                            待ち順を変える
                          </Button>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </section>

      <section className={styles.section} aria-label="キャンセル待ち">
        <div className={styles.sectionHead}>
          <div>
            <h3 className={styles.sectionTitle}>キャンセル待ち</h3>
            <p className={styles.sectionNote}>空きが出たら先頭の方へ期限つきの案内を送ります。期限までに返事がなければ次の方へ</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setWaitlistReason('')
              setWaitlistError('')
              setWaitlistDialog({ kind: 'promote' })
            }}
            disabled={waitlistBusy || waitingRows.length === 0}
          >
            次の方へ案内する
          </Button>
        </div>
        <div className={styles.tableScroll}>
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th style={{ width: '24%' }}>友だち</Th>
                <Th style={{ width: '16%' }}>結果</Th>
                <Th style={{ width: '20%' }}>並んだ日時</Th>
                <Th style={{ width: '20%' }}>案内日時</Th>
                <Th style={{ width: '20%' }}>終了日時</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {[...rows.filter((row) => row.source === 'waitlist'), ...history.map((entry) => ({
                source: 'waitlist' as const,
                id: entry.id,
                friendId: entry.friendId,
                displayName: entry.displayName ?? null,
                pictureUrl: null,
                status: entry.status,
                partySize: entry.partySize,
                appliedAt: entry.createdAt,
                answers: null,
                firstParticipation: { isFirst: null, attendedCount: null, checkedAt: null },
                offeredAt: entry.offeredAt,
                offerExpiresAt: entry.offerExpiresAt,
              }))].map((row) => (
                <Tr key={`${row.source}:${row.id}:${row.status}`}>
                  <Td className="truncate text-sm" title={row.displayName ?? '友だちは未取得'}>{row.displayName ?? '友だちは未取得'}</Td>
                  <Td>
                    <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'} size="compact">
                      {STATUS_LABELS[row.status] ?? row.status}
                    </StatusBadge>
                  </Td>
                  <Td className="text-xs">{formatJp(row.appliedAt, '—')}</Td>
                  <Td className="text-xs">{row.offeredAt ? formatJp(row.offeredAt, '案内日時は未取得') : '—'}</Td>
                  <Td className="text-xs">
                    {row.status === 'waiting' || row.status === 'offered' || row.status === 'accepted'
                      ? '—'
                      : formatJp(history.find((entry) => entry.id === row.id)?.updatedAt ?? null, '—')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </section>

      <section className={styles.section} aria-label="キャンセル">
        <h3 className={styles.sectionTitle}>キャンセル</h3>
        <div className={styles.tableScroll}>
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th style={{ width: '40%' }}>友だち</Th>
                <Th style={{ width: '30%' }}>結果</Th>
                <Th style={{ width: '30%' }}>記録日時</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {history.filter((entry) => entry.status === 'cancelled').map((entry) => (
                <Tr key={entry.id}>
                  <Td className="truncate text-sm" title={entry.displayName ?? '友だちは未取得'}>{entry.displayName ?? '友だちは未取得'}</Td>
                  <Td>
                    <StatusBadge tone="neutral" size="compact">本人が取消</StatusBadge>
                  </Td>
                  <Td className="text-xs">{formatJp(entry.updatedAt, '—')}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </section>

      {canBroadcast ? (
        <section className={styles.section} aria-label="お知らせを送る">
          <h3 className={styles.sectionTitle}>お知らせを送る</h3>
          <p className={styles.sectionNote}>この回の申込者へLINEでまとめて送ります（送ったお知らせは取り消せません）</p>
          <div className={styles.broadcastRow}>
            <input
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="当日は動きやすい服装でお越しください"
              aria-label="申込者へ送るメッセージ"
              className="border-hairline rounded-control border px-3 py-2 text-sm"
              style={{ flex: '1 1 0', minWidth: 0 }}
            />
            <Button variant="secondary" onClick={() => void previewBroadcast()} disabled={broadcastBusy || broadcastMessage.trim() === ''} busy={broadcastBusy} busyLabel="確かめています…">
              送る
            </Button>
          </div>
          {broadcastError ? <p className="text-danger mt-2 text-sm" role="alert">{broadcastError}</p> : null}
        </section>
      ) : null}

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
          <label className="grid gap-1 text-xs font-medium text-ink-secondary">
            断る理由（任意・内部メモ）
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              className="border-hairline rounded-control border px-3 py-2 text-sm font-normal"
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
              <div className="mb-2 flex gap-2">
                <Button
                  variant="secondary"
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
                  variant="secondary"
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
            <label className="grid gap-1 text-xs font-medium text-ink-secondary">
              理由（必須・記録に残ります）
              <textarea
                value={waitlistReason}
                onChange={(e) => setWaitlistReason(e.target.value)}
                rows={2}
                className="border-hairline rounded-control border px-3 py-2 text-sm font-normal"
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
    </div>
  )
}
