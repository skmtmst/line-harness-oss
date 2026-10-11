'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { eventsApi, type EventBookingItem } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { parseEventQuestions } from '@/components/events/event-questions-editor'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { EventRosterTable, EventRosterRow } from '@/components/shared/event-roster'
import { useBookingRequests } from './booking-requests'
import styles from './bookings.module.css'

const PAGE_SIZE = 20
const STATUS_LABELS: Record<string, string> = {
  all: '全件', requested: '承認待ち', confirmed: '確定', rejected: '拒否',
  cancelled: 'キャンセル', expired: '期限切れ', attended: '参加済', no_show: '無断',
}
const REMINDER_KIND_LABELS: Record<string, string> = {
  day_before: '前日のお知らせ', hours_before: '開始前のお知らせ',
}
const REMINDER_STATUS_LABELS: Record<string, string> = {
  pending: '送信予定', sent: '送信済み', cancelled: '停止済み', failed: '失敗', failed_permanent: '失敗',
}

function formatJp(value: string | null | undefined, fallback = '日時未取得') {
  return formatDateTime(value, fallback)
}

type Props = { accountId: string; eventId: string; occurrenceId: string; questionsJson?: string | null; revision?: string }

/** 申込時の記録と通知結果。通常の開催回の表は変えず、必要なときだけ開いて読む。 */
export default function BookingRecords(props: Props) {
  const [open, setOpen] = useState(false)
  return <Disclosure title="申込記録・回答・通知予定" hint="参加済・取消を含む記録" onToggle={setOpen}>
    {open ? <Records key={JSON.stringify([props.accountId, props.eventId, props.occurrenceId])} {...props} /> : null}
  </Disclosure>
}

function Records({ accountId, eventId, occurrenceId, questionsJson, revision }: Props) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [rows, setRows] = useState<EventBookingItem[]>([])
  const [total, setTotal] = useState(0)
  const requests = useBookingRequests(JSON.stringify([accountId, eventId, occurrenceId, filter, page, revision, retry]))
  useEffect(() => {
    const request = requests.start('records', true)
    if (!request) return
    setStatus('loading')
    setRows([])
    setTotal(0)
    void eventsApi.listBookings(accountId, eventId, {
      slot_id: occurrenceId, status: filter === 'all' ? undefined : filter, page, limit: PAGE_SIZE,
    }).then((result) => {
      if (!request.isCurrent()) return
      if (!Array.isArray(result?.items) || !Number.isFinite(result.total) || result.total < 0) throw new Error('malformed_bookings')
      setRows(result.items)
      setTotal(result.total)
      setStatus('ready')
    }).catch(() => {
      if (request.isCurrent()) setStatus('error')
    }).finally(() => { request.finish() })
  }, [accountId, eventId, occurrenceId, filter, page, requests])

  const labels = new Map((parseEventQuestions(questionsJson) ?? []).map((question) => [question.id, question.label]))
  return <>
    <Select aria-label="申込記録の状態" value={filter} onChange={(value) => { setPage(1); setFilter(value) }}
      options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
    {status === 'loading' ? <ListState kind="loading" /> : status === 'error' ?
      <ListState kind="error" description="申込記録を読み込めませんでした。開き直してもう一度お試しください。"
        action={<Button onClick={() => setRetry((value) => value + 1)}>開き直す</Button>} /> : rows.length === 0 ?
      <ListState kind="empty" title="この状態の申込記録はありません" /> : <>
        <EventRosterTable kind="waitlist" label="申込記録" headings={['友だち・回答', '状態', '受付日時', '開催回・通知予定', '個別トーク']}>
          {rows.map((booking) => {
            let answers: Array<[string, unknown]> = []
            try {
              const parsed: unknown = JSON.parse(booking.answer_snapshot_json ?? 'null')
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) answers = Object.entries(parsed)
            } catch { /* 過去の壊れた回答だけを省き、予約と通知結果は残す。 */ }
            return <EventRosterRow key={booking.id}>
              <span role="cell" className={styles.person}>
                <span className={styles.personName} title={booking.friend_display_name ?? booking.friend_name ?? '友だちは未取得'}>{booking.friend_display_name ?? booking.friend_name ?? '友だちは未取得'}</span>
                {booking.line_account_name ? <span className={styles.personSub}>{booking.line_account_name}</span> : null}
                {answers.length ? <dl>{answers.map(([id, answer]) => <div key={id}><dt>{labels.get(id) ?? id}</dt><dd>{Array.isArray(answer) ? answer.join('、') : String(answer)}</dd></div>)}</dl> : null}
                {booking.customer_note ? <span>備考：{booking.customer_note}</span> : null}
                {booking.companion_note ? <span>同行者：{booking.companion_note}</span> : null}
              </span>
              <span role="cell"><StatusBadge tone={booking.status === 'no_show' ? 'danger' : booking.status === 'confirmed' || booking.status === 'attended' ? 'success' : 'neutral'}>{STATUS_LABELS[booking.status] ?? '状態は未取得'}</StatusBadge></span>
              <span role="cell" className={styles.cellText}>{formatJp(booking.requested_at ?? booking.created_at)}</span>
              <span role="cell">
                {formatJp(booking.slot_starts_at)}
                {(booking.reminders ?? []).length ? <ul data-booking-reminders={booking.id}>
                  {(booking.reminders ?? []).map((reminder, index) => <li key={`${reminder.kind}:${reminder.scheduled_at}:${index}`}>
                    {REMINDER_KIND_LABELS[reminder.kind]}{' '}{formatJp(reminder.scheduled_at)}{' '}{REMINDER_STATUS_LABELS[reminder.status] ?? reminder.status}
                  </li>)}
                </ul> : null}
              </span>
              <span role="cell"><Link href={`/chats?friend=${encodeURIComponent(booking.friend_id)}`}>個別トーク</Link></span>
            </EventRosterRow>
          })}
        </EventRosterTable>
        <p>{(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件 / 全{total}件</p>
        <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} onPageChange={setPage} ariaLabel="申込記録のページ送り" />
      </>}
  </>
}
