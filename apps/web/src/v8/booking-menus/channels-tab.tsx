'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import { describeApiFailure } from '@/components/shared/api-error-message'
import {
  bookingChannelsApi,
  type BookingChannel,
  type BookingChannelStaff,
  type BookingChannelsData,
  type BookingConflict,
} from './lib/booking-channels'
import styles from './settings.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const CHANNEL_LABEL: Record<string, { name: string; sub: string; how: string }> = {
  line: { name: 'LINE（musubo の予約）', sub: '予約ページ・リッチメニュー', how: 'そのまま予約管理へ' },
  manual: { name: '電話・店頭', sub: 'スタッフが入れる', how: '予約管理で手入力' },
  hot_pepper_beauty: { name: 'Hot Pepper Beauty', sub: 'SALON BOARD', how: 'Google カレンダー経由（SALON BOARD が書き出せる場合・確認中）' },
  google_reserve: { name: 'Google で予約', sub: 'Google ビジネス プロフィール', how: '予約通知メールを読む' },
  epark: { name: 'EPARK', sub: '予約通知メール', how: '予約通知メールを読む' },
}

function formatReadAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatConflictRange(conflict: BookingConflict): string {
  const starts = new Date(conflict.startsAt)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}） ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const head = Number.isNaN(starts.getTime()) ? '' : `${conflict.staffName}さんの${fmt(starts)}`
  return head
}

function StaffStatusChip({ status }: { status: BookingChannelStaff['status'] }) {
  if (status === 'connected') return <Chip tone="ok">つながっている</Chip>
  if (status === 'expired') return <Chip tone="danger">期限切れ</Chip>
  return <Chip tone="neutral">つないでいない</Chip>
}

function ChannelStatusChip({ channel }: { channel: BookingChannel }) {
  if (channel.status === 'active') return <Chip tone="ok">使っている</Chip>
  if (channel.status === 'confirm') return <Chip tone="warn">確認中</Chip>
  // 口が返す `preparing`（まだ何も届いていない）。「準備中」とは書かない。
  return <Chip tone="neutral">まだ届いていない</Chip>
}

/** Google カレンダーをつなぐ窓（カレンダー ID を入れて確かめる）。 */
function ConnectDialog({
  accountId,
  staff,
  onClose,
  onDone,
}: {
  accountId: string
  staff: BookingChannelStaff
  onClose: () => void
  onDone: () => void
}) {
  const [calendarId, setCalendarId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    const id = calendarId.trim()
    if (!id) {
      setError('カレンダーの ID を入れてください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await bookingChannelsApi.connectCalendar(accountId, staff.staffId, id)
      notifyToast(`${staff.displayName}の Google カレンダーをつなぎました。`)
      onDone()
    } catch (e) {
      setError(describeApiFailure(e, 'つなげませんでした。ID を確かめてやり直してください。'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`${staff.displayName}の Google カレンダーをつなぐ`}
      description="Google カレンダーの ID（メールアドレスの形）を入れると、その予定を「埋まっている時間」として扱います。"
      confirmLabel="つないで確かめる"
      cancelLabel="やめる"
      busy={busy}
      error={error || undefined}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <TextField aria-label="カレンダーの ID" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} placeholder="例：shop@example.com" />
    </Dialog>
  )
}

/** 予約が重なったときの知らせ（DFl3Q）。移す先を選び、移して知らせる。 */
export function ConflictDialog({
  accountId,
  conflict,
  staff,
  onClose,
  onDone,
}: {
  accountId: string
  conflict: BookingConflict
  staff: BookingChannelStaff[]
  onClose: () => void
  onDone: () => void
}) {
  const targets = useMemo(() => staff.filter((s) => s.staffId !== conflict.staffId), [staff, conflict.staffId])
  const [targetId, setTargetId] = useState(targets[0]?.staffId ?? '')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const targetName = targets.find((t) => t.staffId === targetId)?.displayName ?? ''
  const move = async () => {
    if (!targetId) {
      setError('移す先のスタッフを選んでください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await bookingChannelsApi.reassign(accountId, conflict.bookingId, { staffId: targetId, notifyCustomer: notify })
      notifyToast(notify ? `${targetName}へ移して知らせました。` : `${targetName}へ移しました。`)
      onDone()
    } catch (e) {
      setError(describeApiFailure(e, '移せませんでした。空きを確かめてやり直してください。'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-design-node="DFl3Q">
      <Dialog
        open
        title={`${formatConflictRange(conflict)}に予約が重なりました`}
        description="重なったままにすると、どちらかのお客さまをお待たせします。空いているスタッフへ移せます。"
        confirmLabel={notify ? '移して知らせる' : '移す'}
        cancelLabel="あとで"
        busy={busy}
        error={error || undefined}
        onConfirm={() => void move()}
        onCancel={onClose}
      >
        <Select
          aria-label="移す先のスタッフ"
          value={targetId}
          onChange={setTargetId}
          options={[
            { value: '', label: '移す先を選ぶ' },
            ...targets.map((t) => ({ value: t.staffId, label: `${t.displayName}へ移す` })),
          ]}
        />
        <Toggle label="移したことを、お客さまに知らせる" checked={notify} onChange={setNotify} />
      </Dialog>
    </div>
  )
}

/** 予約経路の連携タブ（ZyDd6）。スタッフの Google カレンダーと予約経路の一覧。 */
export default function ChannelsTabV8({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<BookingChannelsData | null>(null)
  const [calendars, setCalendars] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<BookingConflict[]>([])
  const [connectTarget, setConnectTarget] = useState<BookingChannelStaff | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [savingAssign, setSavingAssign] = useState(false)
  const [assignError, setAssignError] = useState('')
  const assignBusy = useRef(false)
  const latestAccountId = useRef(accountId)
  latestAccountId.current = accountId

  async function saveAutoAssign(next: boolean) {
    if (!canEdit || assignBusy.current || !data) return
    assignBusy.current = true
    setSavingAssign(true)
    setAssignError('')
    try {
      await fetchApi(
        `/api/booking/admin/channels/settings?account_id=${encodeURIComponent(accountId)}`,
        { method: 'PUT', body: JSON.stringify({ autoAssign: next }) },
      )
      if (latestAccountId.current !== accountId) return
      setData((current) => current ? { ...current, autoAssign: next } : current)
      notifyToast(next ? '自動割り当てを入れました。' : '自動割り当てを止めました。')
    } catch (e) {
      if (latestAccountId.current === accountId) {
        setAssignError(describeApiFailure(e, '自動割り当てを保存できませんでした。'))
      }
    } finally {
      assignBusy.current = false
      setSavingAssign(false)
    }
  }

  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const [channelsRes, conflictsRes] = await Promise.all([
        bookingChannelsApi.channels(accountId),
        bookingChannelsApi.conflicts(accountId),
      ])
      if (!channelsRes.success) throw new Error(channelsRes.error)
      if (!conflictsRes.success) throw new Error(conflictsRes.error)
      setData(channelsRes.data)
      setConflicts(conflictsRes.data.conflicts)
      setStatus('ready')
      // つながっている分だけカレンダーの ID を読む（失敗しても表は出す）。
      const linked = channelsRes.data.staff.filter((s) => s.status !== 'not_connected')
      const details = await Promise.all(linked.map(async (s) => {
        try {
          const d = await bookingChannelsApi.calendarDetail(accountId, s.staffId)
          return [s.staffId, d.connection?.calendar_id ?? ''] as const
        } catch {
          return [s.staffId, ''] as const
        }
      }))
      setCalendars(Object.fromEntries(details.filter(([, id]) => id)))
    } catch (e) {
      setError(describeApiFailure(e, '予約経路を読み込めませんでした。'))
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const firstConflict = conflicts[0] ?? null

  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error' || !data) {
    return <ListState kind="error" title="予約経路を読み込めませんでした" description={error} action={<Button onClick={() => void load()}>もう一度読む</Button>} />
  }

  return (
    <div className={styles.tabStack}>
      <NoteBar tone="info" help="ほかの予約サービスがスタッフの Google カレンダーへ予約を書き出せれば、その時間は自動で LINE の予約受付から外れます。">
        いちばん確かなのは「スタッフの Google カレンダー」です。
      </NoteBar>
      {firstConflict ? (
        <NoteBar tone="warn">
          予約が {conflicts.length} 件重なっています。
          <Button size="compact" onClick={() => setConflictOpen(true)}>重なりを解消する</Button>
        </NoteBar>
      ) : null}

      <section className={styles.section} aria-label="スタッフの Google カレンダー">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>スタッフの Google カレンダー</h2>
          <p className={styles.sectionDesc}>カレンダーの予定は「埋まっている時間」として扱います。LINE で入った予約は、そのスタッフのカレンダーに書き込みます。</p>
        </div>
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th>スタッフ</Th>
              <Th>カレンダー</Th>
              <Th>状態</Th>
              <Th align="right">外の予定（今週）</Th>
              <Th>最後に読んだ</Th>
              <Th>操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {data.staff.map((person) => (
              <Tr key={person.staffId}>
                <Td>{person.displayName}</Td>
                <Td>{calendars[person.staffId] ?? '—'}</Td>
                <Td><StaffStatusChip status={person.status} /></Td>
                <Td align="right">{person.externalEventsThisWeek == null ? '—' : `${person.externalEventsThisWeek}件`}</Td>
                <Td>{formatReadAt(person.lastReadAt)}</Td>
                <Td>
                  {canEdit ? (
                    <Button size="compact" onClick={() => setConnectTarget(person)}>
                      {person.status === 'not_connected' ? 'つなぐ' : 'つなぎ直す'}
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </section>

      <section className={styles.section} aria-label="予約経路">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>予約経路</h2>
          <p className={styles.sectionDesc}>どこから入った予約も「予約管理」に集めます。入り口ごとの受け取り方と、今日の件数です。</p>
        </div>
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th>予約経路</Th>
              <Th>受け取り方</Th>
              <Th>状態</Th>
              <Th align="right">今日</Th>
              <Th>最後に届いた</Th>
              <Th>操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {data.channels.map((channel) => {
              const label = CHANNEL_LABEL[channel.key] ?? { name: channel.key, sub: '', how: '' }
              return (
                <Tr key={channel.key}>
                  <Td>
                    <span className="block font-semibold text-ink">{label.name}</span>
                    {label.sub ? <span className="block text-xs text-ink-secondary">{label.sub}</span> : null}
                  </Td>
                  <Td>{label.how || '—'}</Td>
                  <Td><ChannelStatusChip channel={channel} /></Td>
                  <Td align="right">{channel.todayCount == null ? '—' : `${channel.todayCount}件`}</Td>
                  <Td>—</Td>
                  <Td>
                    {channel.status === 'active' && (channel.key === 'line' || channel.key === 'manual') ? (
                      <Button href="/booking/bookings" size="compact">予約管理へ</Button>
                    ) : null}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </section>

      <section className={styles.section} data-design-node="wJYQb" aria-label="外から予約が入ったとき">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>外から予約が入ったとき</h2>
        </div>
        {canEdit ? (
          <fieldset disabled={savingAssign} className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>指名なしの予約は、その時間に空いているスタッフへ自動で割り当て</span>
            <Toggle
              label="指名なしの予約は、その時間に空いているスタッフへ自動で割り当て"
              checked={data.autoAssign}
              onChange={(next) => void saveAutoAssign(next)}
            />
          </fieldset>
        ) : (
          // 閲覧のみ：つまみは置かず、いまの設定を文字で見せる（2026-10-06 オーナー決定）。
          <p className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>指名なしの予約は、その時間に空いているスタッフへ自動で割り当て</span>
            <span className="text-sm text-ink-secondary">{data.autoAssign ? 'オン' : 'オフ'}</span>
          </p>
        )}
        {assignError ? <p role="alert" className="text-sm text-ink-secondary">{assignError}</p> : null}
      </section>

      {connectTarget ? (
        <ConnectDialog accountId={accountId} staff={connectTarget} onClose={() => setConnectTarget(null)} onDone={() => { setConnectTarget(null); void load() }} />
      ) : null}
      {conflictOpen && firstConflict ? (
        <ConflictDialog accountId={accountId} conflict={firstConflict} staff={data.staff} onClose={() => setConflictOpen(false)} onDone={() => { setConflictOpen(false); void load() }} />
      ) : null}
    </div>
  )
}
