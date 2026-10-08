'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
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
import type { BookingStaff } from '@/lib/api'
import styles from './settings.module.css'
import ch from './channels.module.css'

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
  if (status === 'connected') return <StatusBadge tone="success">つながっている</StatusBadge>
  if (status === 'expired') return <StatusBadge tone="danger">期限切れ</StatusBadge>
  return <StatusBadge tone="neutral">つないでいない</StatusBadge>
}

function ChannelStatusChip({ channel }: { channel: BookingChannel }) {
  if (channel.status === 'active') return <StatusBadge tone="success">使っている</StatusBadge>
  if (channel.status === 'confirm') return <StatusBadge tone="warning">確認中</StatusBadge>
  // 口が返す `preparing`（まだ何も届いていない）。「準備中」とは書かない。
  return <StatusBadge tone="neutral">まだ届いていない</StatusBadge>
}

/** 1行で収め、はみ出す分は「…」にして title で全文を見せる。 */
function OneLine({ text, tone }: { text: string; tone?: 'name' | 'sub' }) {
  return <span className={tone === 'name' ? `${ch.oneLine} ${ch.name}` : tone === 'sub' ? `${ch.oneLine} ${ch.sub}` : ch.oneLine} title={text}>{text}</span>
}

/** つながっているカレンダーの中身（「予定を見る」）。つなぎ直す口もここに置く。 */
function CalendarDetailDialog({
  staff,
  calendarId,
  canEdit,
  onClose,
  onReconnect,
}: {
  staff: BookingChannelStaff
  calendarId: string
  canEdit: boolean
  onClose: () => void
  onReconnect: () => void
}) {
  return (
    <Dialog
      open
      title={`${staff.displayName}の Google カレンダー`}
      description="カレンダーの予定は「埋まっている時間」として扱います。"
      confirmLabel="つなぎ直す"
      onConfirm={canEdit ? onReconnect : undefined}
      onCancel={onClose}
    >
      <dl className={ch.detail}>
        <div className={ch.detailRow}><dt className={ch.detailKey}>カレンダー</dt><dd className={ch.detailValue}>{calendarId || '—'}</dd></div>
        <div className={ch.detailRow}><dt className={ch.detailKey}>状態</dt><dd className={ch.detailValue}><StaffStatusChip status={staff.status} /></dd></div>
        <div className={ch.detailRow}><dt className={ch.detailKey}>外の予定（今週）</dt><dd className={ch.detailValue}>{staff.externalEventsThisWeek == null ? '—' : `${staff.externalEventsThisWeek}件`}</dd></div>
        <div className={ch.detailRow}><dt className={ch.detailKey}>最後に読んだ</dt><dd className={ch.detailValue}>{formatReadAt(staff.lastReadAt)}</dd></div>
        {staff.readError ? <div className={ch.detailRow}><dt className={ch.detailKey}>読めなかった理由</dt><dd className={ch.detailValue}>{staff.readError}</dd></div> : null}
      </dl>
    </Dialog>
  )
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
export default function ChannelsTabV8({ accountId, canEdit, staff = [] }: { accountId: string; canEdit: boolean; staff?: BookingStaff[] }) {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<BookingChannelsData | null>(null)
  const [calendars, setCalendars] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<BookingConflict[]>([])
  const [connectTarget, setConnectTarget] = useState<BookingChannelStaff | null>(null)
  const [detailTarget, setDetailTarget] = useState<BookingChannelStaff | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [savingAssign, setSavingAssign] = useState(false)
  const [assignError, setAssignError] = useState('')
  const assignBusy = useRef(false)
  const latestAccountId = useRef(accountId)
  latestAccountId.current = accountId
  /* 名前の下の1行（役割）。予約設定の担当スタッフと同じ人だけ出す。 */
  const roles = useMemo(() => Object.fromEntries(staff.map((person) => [person.id, person.role ?? ''])), [staff])

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

  /* WEB058：アカウントを変えたら、前のアカウントの遅い応答（一覧・重なり・カレンダー）を捨てる。 */
  const loadGeneration = useRef(0)
  useEffect(() => {
    setData(null)
    setCalendars({})
    setConflicts([])
    setConflictOpen(false)
    return () => { loadGeneration.current += 1 }
  }, [accountId])

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const alive = () => generation === loadGeneration.current
    setStatus('loading')
    setError('')
    try {
      const [channelsRes, conflictsRes] = await Promise.all([
        bookingChannelsApi.channels(accountId),
        bookingChannelsApi.conflicts(accountId),
      ])
      if (!alive()) return
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
      if (!alive()) return
      setCalendars(Object.fromEntries(details.filter(([, id]) => id)))
    } catch (e) {
      if (!alive()) return
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
      {/* 絵 ZyDd6：緑の帯に1行で全文。 */}
      <p className={ch.band}>
        いちばん確かなのは「スタッフの Google カレンダー」です。ほかの予約サービスがスタッフの Google カレンダーへ予約を書き出せれば、その時間は自動で LINE の予約受付から外れます（いまの作りでできます）。
      </p>
      {firstConflict ? (
        <NoteBar tone="warn">
          予約が {conflicts.length} 件重なっています。
          {/* WEB059：閲覧のみには、付け替え（書き込み）へ進む口を置かない。重なりの知らせは出す。 */}
          {canEdit ? <Button size="compact" onClick={() => setConflictOpen(true)}>重なりを解消する</Button> : null}
        </NoteBar>
      ) : null}

      <section className={ch.card} aria-labelledby="channels-calendar-heading">
        <h2 id="channels-calendar-heading" className={ch.cardTitle}>スタッフの Google カレンダー</h2>
        <p className={ch.cardDesc}>カレンダーの予定は「埋まっている時間」として扱います。LINE で入った予約は、そのスタッフのカレンダーに書き込みます。</p>
        <div className={ch.table} role="table" aria-label="スタッフの Google カレンダー">
          <div className={`${ch.row} ${ch.headRow} ${ch.staffCols}`} role="row">
            <span className={ch.head} role="columnheader">スタッフ</span>
            <span className={ch.head} role="columnheader">カレンダー</span>
            <span className={ch.head} role="columnheader">状態</span>
            <span className={`${ch.head} ${ch.right}`} role="columnheader">外の予定（今週）</span>
            <span className={ch.head} role="columnheader">最後に読んだ</span>
            <span className={ch.head} role="columnheader">操作</span>
          </div>
          {data.staff.map((person) => {
            const role = roles[person.staffId]
            const calendarId = calendars[person.staffId] ?? ''
            return (
              <div key={person.staffId} className={`${ch.row} ${ch.staffCols}`} role="row">
                <span className={ch.nameCell} role="cell">
                  <OneLine text={person.displayName} tone="name" />
                  {role ? <OneLine text={role} tone="sub" /> : null}
                </span>
                <span className={ch.cell} role="cell"><OneLine text={calendarId || '—'} /></span>
                <span className={ch.cell} role="cell"><StaffStatusChip status={person.status} /></span>
                <span className={`${ch.cell} ${ch.right}`} role="cell">{person.externalEventsThisWeek == null ? '—' : `${person.externalEventsThisWeek}件`}</span>
                <span className={ch.cell} role="cell">{formatReadAt(person.lastReadAt)}</span>
                <span className={ch.cell} role="cell">
                  {person.status === 'connected' ? (
                    <Button onClick={() => setDetailTarget(person)}>予定を見る</Button>
                  ) : canEdit ? (
                    <Button onClick={() => setConnectTarget(person)}>
                      {person.status === 'not_connected' ? 'つなぐ' : 'つなぎ直す'}
                    </Button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section className={ch.card} aria-labelledby="channels-route-heading">
        <h2 id="channels-route-heading" className={ch.cardTitle}>予約経路</h2>
        <p className={ch.cardDesc}>どこから入った予約も「予約管理」に集めます。入り口ごとの受け取り方と、今日の件数です。</p>
        <div className={ch.table} role="table" aria-label="予約経路">
          <div className={`${ch.row} ${ch.headRow} ${ch.routeCols}`} role="row">
            <span className={ch.head} role="columnheader">予約経路</span>
            <span className={ch.head} role="columnheader">受け取り方</span>
            <span className={ch.head} role="columnheader">状態</span>
            <span className={`${ch.head} ${ch.right}`} role="columnheader">今日</span>
            <span className={ch.head} role="columnheader">最後に届いた</span>
            <span className={ch.head} role="columnheader">操作</span>
          </div>
          {data.channels.map((channel) => {
            const label = CHANNEL_LABEL[channel.key] ?? { name: channel.key, sub: '', how: '' }
            return (
              <div key={channel.key} className={`${ch.row} ${ch.routeCols}`} role="row">
                <span className={ch.nameCell} role="cell">
                  <OneLine text={label.name} tone="name" />
                  {label.sub ? <OneLine text={label.sub} tone="sub" /> : null}
                </span>
                <span className={`${ch.cell} ${ch.wrap}`} role="cell">{label.how || '—'}</span>
                <span className={ch.cell} role="cell"><ChannelStatusChip channel={channel} /></span>
                <span className={`${ch.cell} ${ch.right}`} role="cell">{channel.todayCount == null ? '—' : `${channel.todayCount}件`}</span>
                <span className={ch.cell} role="cell">—</span>
                <span className={ch.cell} role="cell">
                  {channel.status === 'active' && (channel.key === 'line' || channel.key === 'manual') ? (
                    <Button href="/booking/bookings">予約管理へ</Button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
        <p className={ch.note}>Google カレンダーに書き出せない入り口は、予約通知メールを取り込みアドレスへ転送して読み取ります（見本のメールがそろった媒体から順に）。</p>
      </section>

      <section className={ch.card} data-design-node="wJYQb" aria-labelledby="channels-assign-heading">
        <h2 id="channels-assign-heading" className={ch.cardTitle}>外から予約が入ったとき</h2>
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
            <span className={ch.cardDesc}>{data.autoAssign ? 'オン' : 'オフ'}</span>
          </p>
        )}
        {assignError ? <p role="alert" className={ch.cardDesc}>{assignError}</p> : null}
      </section>

      {detailTarget ? (
        <CalendarDetailDialog
          staff={detailTarget}
          calendarId={calendars[detailTarget.staffId] ?? ''}
          canEdit={canEdit}
          onClose={() => setDetailTarget(null)}
          onReconnect={() => { setConnectTarget(detailTarget); setDetailTarget(null) }}
        />
      ) : null}
      {connectTarget ? (
        <ConnectDialog accountId={accountId} staff={connectTarget} onClose={() => setConnectTarget(null)} onDone={() => { setConnectTarget(null); void load() }} />
      ) : null}
      {canEdit && conflictOpen && firstConflict ? (
        <ConflictDialog accountId={accountId} conflict={firstConflict} staff={data.staff} onClose={() => setConflictOpen(false)} onDone={() => { setConflictOpen(false); void load() }} />
      ) : null}
    </div>
  )
}
