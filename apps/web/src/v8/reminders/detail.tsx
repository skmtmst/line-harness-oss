'use client'

/*
 * ★V8 リマインダの詳細（src/v8 に一から書いた版）。
 * 板：rbAig（概要）/ loVfW（登録者）/ RwVo5（一時停止の窓）。
 * 枠は型（PageFrame）。頭の中にタブを持つ形（絵の「板の頭」）は型の頭に無いので、ここで組む。
 * 読む口・操作は今の画面（app/reminders/detail/detail-v8.tsx）と同じ。BEHAVIOR.md に一覧がある。
 */
import { useSamePageUrl } from '@/lib/use-same-page-url'
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  CircleAlert,
  Copy,
  Download,
  Info,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { describeReminderTiming, type Reminder, type ReminderStep } from '@line-crm/shared'
import {
  api,
  ApiError,
  type ReminderDeliveryRun,
  type ReminderDeliveryRunsResponse,
  type ReminderDeliveryRunStatus,
  type ReminderRegistrant,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatDateTime, formatNumber } from '@/lib/format'
import { csvCell } from '@/lib/presentation'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame } from '@/components/templates/page-frame'
import { CreateSummaryCard } from '@/components/templates/create-parts'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateTimeField from '@/components/shared/date-time-field'
import FilterChip from '@/components/shared/filter-chip'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { Tabs } from '@/components/shared/tabs'
import PageSizeSelect from '@/components/ui/page-size-select'
import { reminderTriggerLabel, renderReminderBodySample } from '@/components/reminders/reminder-labels'
import SheetDialog from './sheet-dialog'
import styles from './detail.module.css'

const PAGE_SIZE = 20
/** 書き出しの上限。実行結果が多いとき、手元に全部ため込むと固まる。 */
const EXPORT_LIMIT = 5000
/** 配信予定を一度に取る件数。予定は近い順に返る。 */
const PLANNED_LIMIT = 100
const DAY_MS = 86_400_000

const STATUS_VIEW: Record<ReminderDeliveryRunStatus, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  planned: { label: '配信予定', tone: 'muted' },
  claimed: { label: '送信処理中', tone: 'muted' },
  succeeded: { label: '送れた', tone: 'ok' },
  skipped: { label: '送信なし', tone: 'muted' },
  retry_wait: { label: '再試行待ち', tone: 'warn' },
  permanent_failed: { label: '失敗', tone: 'warn' },
  cancelled: { label: '取り消し', tone: 'muted' },
}

export type DetailTab = 'overview' | 'schedule' | 'runs' | 'registrants'

/** URL の ?tab=（今の画面と同じ名前）。 */
export function tabFromParam(value: string | null): DetailTab {
  if (value === 'schedule' || value === 'runs' || value === 'registrants') return value
  return 'overview'
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']
const JST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
})

function jstParts(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(JST_PARTS.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const weekday = WEEKDAYS_JA[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)] ?? ''
  return { year: parts.year, month: Number(parts.month), day: Number(parts.day), time: `${parts.hour}:${parts.minute}`, weekday }
}

/** 「10/1（水）18:00」（日本時間）。 */
function formatMd(value: string | null): string {
  const p = jstParts(value)
  return p ? `${p.month}/${p.day}（${p.weekday}）${p.time}` : '—'
}

/** 「9/30 18:00」（日本時間）。 */
function formatShort(value: string | null): string {
  const p = jstParts(value)
  return p ? `${p.month}/${p.day} ${p.time}` : '—'
}

/** 「9月28日」（日本時間）。 */
function formatMonthDay(value: string | null): string {
  const p = jstParts(value)
  return p ? `${p.month}月${p.day}日` : ''
}

function formatJst(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return formatDateTime(parsed)
}

/** API の UTC ISO を、どの端末でも同じ JST の datetime-local 値へ変える。 */
const JST_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
export function dateTimeLocalJst(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(JST_LOCAL.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** datetime-local の JST の壁時計時刻を、曖昧さなく UTC ISO へ変える。 */
export function dateTimeLocalJstToUtcIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 9, minute))
  // 2月30日などを Date が翌月へ丸めても保存しない。
  return dateTimeLocalJst(utc.toISOString()) === value ? utc.toISOString() : null
}

/** 通知の短い呼び名。日で書いた通は「1日前 18:00」、分で書いた通は「1時間前」。 */
function stepTiming(step: ReminderDeliveryRunsResponse['steps'][number], detail: ReminderStep | undefined, mode: Reminder['deliveryMode']): string {
  if (detail && mode === 'time' && detail.offsetDays != null && detail.sendAtTime) {
    const days = detail.offsetDays
    return `${days === 0 ? '当日' : days < 0 ? `${-days}日前` : `${days}日後`} ${detail.sendAtTime}`
  }
  return describeReminderTiming({ offsetMinutes: step.offsetMinutes }, 'countdown').replace('ゴールちょうど', '基準時刻')
}

/** 通知の本文を、番号だけでなく人が見分けられる短い名前にする。 */
function stepLabel(step: ReminderDeliveryRunsResponse['steps'][number]): string {
  const firstLine = step.messageContent.trim().split(/\r?\n/, 1)[0]?.trim()
  return firstLine ? firstLine.slice(0, 40) : `${step.stepNumber}通目`
}

function csvFor(items: ReminderDeliveryRun[]): string {
  const rows = [
    ['友だち', '通知', '結果', '配信予定', '実行時刻', '試行回数', '次の再試行', 'LINE要求ID', '理由'],
    ...items.map((item) => [
      item.friendName ?? '削除済みの友だち',
      `${item.stepNumber}通目`,
      STATUS_VIEW[item.domainStatus].label,
      formatJst(item.scheduledAt),
      formatJst(item.completedAt ?? item.startedAt),
      item.attemptCount,
      formatJst(item.nextRetryAt),
      item.lineRequestId ?? '—',
      item.lastErrorMessage ?? '',
    ]),
  ]
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  return (
    <span className={styles.pill} data-tone={tone}>
      <span className={styles.pillDot} aria-hidden="true" />
      {children}
    </span>
  )
}

export default function ReminderDetailV8Page() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ReminderDetailV8 />
    </Suspense>
  )
}

function ReminderDetailV8() {
  const router = useRouter()
  const samePageUrl = useSamePageUrl()
  const searchParams = useSearchParams()
  const reminderId = searchParams.get('id') ?? ''
  const tab = tabFromParam(searchParams.get('tab'))
  const runsStatusParam = searchParams.get('runStatus')
  const { selectedAccount, selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canManage = canManageRole(staffRole)

  const [data, setData] = useState<ReminderDeliveryRunsResponse | null>(null)
  const [reminder, setReminder] = useState<(Reminder & { steps?: ReminderStep[] }) | null>(null)
  const [planned, setPlanned] = useState<ReminderDeliveryRun[]>([])
  const [plannedTotal, setPlannedTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [confirmPause, setConfirmPause] = useState(false)
  const [pausing, setPausing] = useState(false)

  usePageTitle(data?.reminder.name ? `${data.reminder.name}・リマインダ` : null)

  const load = useCallback(async () => {
    // id なしで帰ると「読み込んでいます」が永遠に出る。先に止めて文面を出す。
    if (!reminderId) {
      setLoading(false)
      setError('')
      setMissing(false)
      return
    }
    setLoading(true)
    setError('')
    setMissing(false)
    // 読み直しに失敗したとき、前に取れた数字を現在値として残さない。
    setData(null)
    setReminder(null)
    try {
      const [runsRes, reminderRes] = await Promise.all([
        api.reminders.runs(reminderId, { limit: 5, offset: 0 }),
        api.reminders.get(reminderId),
      ])
      if (!runsRes.success) throw new Error(runsRes.error)
      setData(runsRes.data)
      if (reminderRes.success) setReminder(reminderRes.data)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
      } else {
        setError('リマインダの詳細を読み込めませんでした。時間を置いてもう一度お試しください。')
      }
    } finally {
      setLoading(false)
    }
  }, [reminderId])

  useEffect(() => {
    void load()
  }, [load, selectedAccountId])

  /*
   * 「次に送る」（通知ごとの最早の予定）と、一時停止の窓の「今後24時間で送る予定」は
   * 配信予定（status=planned）から数える。
   */
  useEffect(() => {
    if (!reminderId) return
    let cancelled = false
    void api.reminders.runs(reminderId, { status: 'planned', limit: PLANNED_LIMIT }).then((res) => {
      if (cancelled || !res.success) return
      setPlanned(res.data.items)
      setPlannedTotal(res.data.pagination.total)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [reminderId, selectedAccountId])

  const selectTab = (next: DetailTab) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('id', reminderId)
    params.set('tab', next)
    if (next !== 'runs') params.delete('runStatus')
    samePageUrl.replace(`/reminders/detail?${params.toString()}`)
  }

  /* ===== 状態を変える操作 ===== */

  // 公開版の無い下書きは「停止中」ではなく「下書き」。再開は公開の経路に統一し、この画面からは出さない。
  const isUnpublishedDraft = data ? !data.reminder.hasPublishedVersion : false

  const setReminderActive = async (isActive: boolean): Promise<boolean> => {
    if (!data || data.reminder.isActive === isActive) return true
    setActionMessage('')
    try {
      const response = await api.reminders.update(reminderId, { isActive })
      if (!response.success) throw new Error(response.error)
      setData((current) => current ? { ...current, reminder: { ...current.reminder, isActive } } : current)
      setActionMessage(isActive ? 'リマインダを再開しました。' : 'リマインダを一時停止しました。')
      return true
    } catch (caught) {
      // API も未公開の再開を 409 で止める。その文面をそのまま出す。
      setActionMessage(caught instanceof ApiError && caught.status === 409
        ? caught.message
        : isActive
          ? '再開できませんでした。状態を読み直してからお試しください。'
          : '一時停止できませんでした。状態を読み直してからお試しください。')
      return false
    }
  }

  const runPause = async () => {
    if (pausing) return
    setPausing(true)
    const ok = await setReminderActive(false)
    setPausing(false)
    if (ok) setConfirmPause(false)
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setActionMessage('')
    try {
      const all: ReminderDeliveryRun[] = []
      let offset = 0
      let total = 0
      for (;;) {
        const response = await api.reminders.runs(reminderId, { limit: 100, offset })
        if (!response.success) throw new Error(response.error)
        total = response.data.pagination.total
        for (const item of response.data.items) {
          if (all.length >= EXPORT_LIMIT) break
          all.push(item)
        }
        offset += response.data.items.length
        if (all.length >= EXPORT_LIMIT || offset >= total || response.data.items.length === 0) break
      }
      if (total > EXPORT_LIMIT) {
        setActionMessage(`件数が多いため、全${formatNumber(total)}件のうち${formatNumber(EXPORT_LIMIT)}件まで書き出しました。`)
      }
      const url = URL.createObjectURL(new Blob([csvFor(all)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `reminder-runs-${reminderId}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionMessage('CSVを書き出せませんでした。もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  /* ===== 複製（下書きとして写す。一覧と同じ手順） ===== */

  const runDuplicate = async () => {
    if (duplicating) return
    setDuplicating(true)
    setActionMessage('')
    try {
      const draft = await api.reminders.getDraft(reminderId)
      if (!draft.success) throw new Error(draft.error)
      const res = await api.reminders.createDraft({
        ...draft.data.settings,
        name: `${data?.reminder.name ?? 'リマインダ'} のコピー`,
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/reminders/edit?id=${encodeURIComponent(String(res.data.reminderId))}&stage=target`)
    } catch {
      setActionMessage('複製できませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setDuplicating(false)
    }
  }

  /* ===== 削除 ===== */

  const runDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.reminders.delete(reminderId)
      if (!res.success) throw new Error(res.error)
      router.push('/reminders')
    } catch {
      setDeleteError('削除できませんでした。時間を置いてもう一度お試しください。')
      setDeleting(false)
    }
  }

  // 閲覧のみの人には、押せない操作を置かない（書き出しだけ残す）。
  const menuItems: ActionMenuItem[] = [
    {
      id: 'csv',
      label: '実行結果をCSVで書き出す',
      icon: <Download size={15} aria-hidden="true" />,
      disabled: exporting || loading,
      onSelect: () => void exportCsv(),
    },
    ...(canManage ? [
      {
        id: 'duplicate',
        label: '複製する',
        icon: <Copy size={15} aria-hidden="true" />,
        disabled: duplicating,
        onSelect: () => void runDuplicate(),
      },
      {
        id: 'delete',
        label: '削除する',
        icon: <Trash2 size={15} aria-hidden="true" />,
        tone: 'danger' as const,
        dividerBefore: true,
        onSelect: () => setConfirmDelete(true),
      },
    ] : []),
  ]

  const nextByStep = useMemo(() => {
    const next: Record<number, string> = {}
    for (const item of planned) {
      if (item.domainStatus !== 'planned' && item.domainStatus !== 'claimed' && item.domainStatus !== 'retry_wait') continue
      const at = item.domainStatus === 'retry_wait' ? item.nextRetryAt : item.scheduledAt
      if (!at) continue
      const current = next[item.stepNumber]
      if (!current || at < current) next[item.stepNumber] = at
    }
    return next
  }, [planned])

  // 一時停止の窓：今後24時間で送る予定の数（取れた予定の中で数える。取り切れていなければ「以上」）。
  const pauseImpact = useMemo(() => {
    const now = Date.now()
    const within = planned.filter((item) => {
      const at = Date.parse(item.scheduledAt ?? '')
      return Number.isFinite(at) && at >= now && at <= now + DAY_MS
    }).length
    /*
     * WEB084：予定は新しい順で最大100件しか読めない。読めていない予定があるときは、
     * 近い予定が抜けていることがあるので、数を言い切らない（0 と言わない）。
     * 近い順・件数の集計は口に頼んでいる（Codex）。
     */
    const truncated = plannedTotal > planned.length
    return { count: within, truncated }
  }, [planned, plannedTotal])
  const plannedPartial = plannedTotal > planned.length

  if (!reminderId) {
    return (
      <ListState kind="empty" title="リマインダが指定されていません" description="一覧から選び直してください。" action={<Button href="/reminders">リマインダ一覧へ戻る</Button>} />
    )
  }
  if (loading) return <ListState kind="loading" title="リマインダの詳細を読み込んでいます" />
  if (missing) {
    return (
      <ListState kind="empty" title="このリマインダは見つかりません" description="削除されたか、別の記録です。一覧から選び直してください。" action={<Button href="/reminders">リマインダ一覧へ戻る</Button>} />
    )
  }
  if (error || !data) {
    return <ListState kind="error" title="詳細を表示できませんでした" description={error || '詳細を読み込めませんでした。'} onRetry={() => void load()} />
  }

  const hasErrors = data.summary.errors > 0
  const firstStep = data.steps[0] ?? null
  const statusLabel = !data.reminder.hasPublishedVersion ? '下書き' : data.reminder.isActive ? '稼働中' : '停止中'
  const nextTime = jstParts(data.summary.nextScheduledAt)?.time ?? ''
  const accountName = selectedAccount?.name ?? 'LINE公式アカウント'
  const meta = [
    reminder?.triggerType ? `基準日：${reminderTriggerLabel(reminder.triggerType)}` : null,
    `通知 ${data.steps.length}通`,
    reminder?.updatedAt ? `更新 ${formatMonthDay(reminder.updatedAt)}` : null,
  ].filter(Boolean).join('・')

  return (
    <PageFrame kind="detail" boardId={tab === 'registrants' ? 'loVfW' : 'rbAig'}>
      <header className={styles.head} data-template-region="heading">
        <Link href="/reminders" className={styles.backLink}>
          <ChevronLeft size={14} aria-hidden="true" />
          リマインダへ
        </Link>
        <h1 className={styles.title} title={data.reminder.name}>{data.reminder.name}</h1>
        <p className={styles.meta}>{meta}</p>
        <Tabs
          label="リマインダの詳細"
          items={[
            { label: '概要', current: tab === 'overview', onClick: () => selectTab('overview') },
            { label: '配信予定', current: tab === 'schedule', onClick: () => selectTab('schedule') },
            { label: '実行結果', current: tab === 'runs', onClick: () => selectTab('runs') },
            { label: '登録者', current: tab === 'registrants', onClick: () => selectTab('registrants') },
          ]}
        />
      </header>

      <div className={styles.split}>
        <div className={styles.main}>
          {actionMessage ? <Notice tone="info">{actionMessage}</Notice> : null}
          {tab === 'overview' ? (
            <OverviewTab
              data={data}
              reminder={reminder}
              nextByStep={plannedPartial ? null : nextByStep}
              onShowErrors={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.set('id', reminderId)
                params.set('tab', 'runs')
                params.set('runStatus', 'permanent_failed')
                samePageUrl.replace(`/reminders/detail?${params.toString()}`)
              }}
              onShowAllRuns={() => selectTab('runs')}
            />
          ) : tab === 'schedule' ? (
            <ScheduleTab reminderId={reminderId} steps={data.steps} />
          ) : tab === 'runs' ? (
            <RunsTab
              // 概要の警告帯から飛んだとき、絞り込みを確実に掛け直す。
              key={runsStatusParam ?? ''}
              reminderId={reminderId}
              canManage={canManage}
              initialStatus={runsStatusParam === 'permanent_failed' ? 'permanent_failed' : ''}
            />
          ) : (
            <RegistrantsTab reminderId={reminderId} canManage={canManage} />
          )}
        </div>

        <aside className={styles.side} aria-label="いまの状態と操作">
          <div className={styles.sideActions}>
            {canManage && !isUnpublishedDraft ? (
              data.reminder.isActive ? (
                <Button className={styles.sideAction} onClick={() => setConfirmPause(true)}>
                  <Pause size={15} aria-hidden="true" />一時停止する
                </Button>
              ) : (
                <Button className={styles.sideAction} onClick={() => void setReminderActive(true)}>
                  <Play size={15} aria-hidden="true" />再開する
                </Button>
              )
            ) : null}
            {canManage ? (
              <Button className={styles.sideAction} onClick={() => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}`)}>
                <Pencil size={15} aria-hidden="true" />
                {isUnpublishedDraft ? '編集を続ける' : '編集する'}
              </Button>
            ) : null}
            <span className={styles.menuAnchor}>
              <RowMenu
                className={styles.menuButton}
                label={`リマインダ「${data.reminder.name}」のその他の操作`}
                title="その他の操作"
                items={menuItems}
              />
            </span>
          </div>

          <CreateSummaryCard
            title="いまの状態"
            rows={[
              { key: 'state', label: '状態', value: <span className={styles.valueState} data-tone={statusLabel === '稼働中' ? 'ok' : undefined}>{statusLabel}</span> },
              { key: 'registrants', label: '登録者', value: `${formatNumber(data.summary.targetCount)}人` },
              { key: 'next7', label: 'これから送る（今後7日）', value: `${formatNumber(data.summary.scheduledNext7Days ?? 0)}通` },
              { key: 'month', label: '今月送った', value: `${formatNumber(data.summary.sentThisMonth ?? 0)}通` },
              { key: 'errors', label: '失敗', value: <span className={hasErrors ? styles.valueDanger : undefined}>{`${formatNumber(data.summary.errors)}通`}</span> },
            ]}
          />

          {tab === 'registrants' ? null : (
            <div className={styles.phoneWrap}>
            <LinePreview
              accountName={accountName}
              caption={data.summary.nextScheduledAt ? formatMd(data.summary.nextScheduledAt) : '次の送信予定はありません'}
              note="届き方：次に送る通知が、友だちのLINEにこう届きます。差し込みは見本の値です。"
              empty={!firstStep}
            >
              {firstStep ? (
                <LinePreviewMessage accountName={accountName} avatar={accountName.slice(0, 1)} time={nextTime}>
                  {renderReminderBodySample(firstStep.messageContent || '本文はまだありません')}
                </LinePreviewMessage>
              ) : null}
            </LinePreview>
            </div>
          )}
        </aside>
      </div>

      <SheetDialog
        open={confirmPause}
        designNode="RwVo5"
        title={`「${data.reminder.name}」を一時停止する`}
        description="止めているあいだ、通知は送りません。止めているあいだに送る予定だった通知は、再開しても送りません（過去の日時になるため）"
        band={pauseImpact.truncated
          ? `送る予定の ${formatNumber(plannedTotal)}通が送られなくなります（今後24時間の分は数え切れませんでした）。`
          : `今後24時間で送る予定の ${formatNumber(pauseImpact.count)}通 が送られなくなります。`}
        busy={pausing}
        onClose={() => { if (!pausing) setConfirmPause(false) }}
        actions={(
          <>
            <Button onClick={() => setConfirmPause(false)} disabled={pausing}>キャンセル</Button>
            <Button variant="primary" onClick={() => void runPause()} disabled={pausing} busy={pausing} busyLabel="止めています…">
              <Pause size={15} aria-hidden="true" />一時停止する
            </Button>
          </>
        )}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`「${data.reminder.name}」を削除しますか`}
        description="登録者への未送信の通知と送信の履歴も消えます。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void runDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </PageFrame>
  )
}

/* ===== 概要タブ（rbAig） ===== */

function OverviewTab({
  data,
  reminder,
  nextByStep,
  onShowErrors,
  onShowAllRuns,
}: {
  data: ReminderDeliveryRunsResponse
  reminder: (Reminder & { steps?: ReminderStep[] }) | null
  /** WEB084：予定を読み切れていないときは null（「次に送る」を言い切らない）。 */
  nextByStep: Record<number, string> | null
  onShowErrors: () => void
  onShowAllRuns: () => void
}) {
  const hasErrors = data.summary.errors > 0
  const detailSteps = reminder?.steps ?? []
  // 「最近の実行」は送った・送れなかったものだけ。これから送る予定（配信予定・処理中）は配信予定タブに出す。
  const recent = data.items.filter((item) => item.domainStatus !== 'planned' && item.domainStatus !== 'claimed').slice(0, 5)

  return (
    <>
      {hasErrors ? (
        <div className={styles.failBand} role="alert">
          <CircleAlert size={18} className={styles.failIcon} aria-hidden="true" />
          <div className={styles.failText}>
            <p className={styles.failTitle}>送れなかった通知が {formatNumber(data.summary.errors)}通あります</p>
            <p className={styles.failNote}>友だちがブロックしていたか、LINE が受け付けませんでした。理由を見て、送り直せます。</p>
          </div>
          <Button onClick={onShowErrors}>
            <ArrowRight size={15} aria-hidden="true" />実行結果を見る
          </Button>
        </div>
      ) : null}

      <section className={styles.card} aria-labelledby="rm-detail-steps">
        <div className={styles.cardHead}>
          <h2 id="rm-detail-steps" className={styles.cardTitle}>通知ごとの送信状況</h2>
          <p className={styles.cardNote}>LINEでは、友だち単位の既読は分かりません</p>
        </div>
        <div className={styles.table} role="table" aria-label="通知ごとの送信状況">
          <div className={styles.headRow} role="row">
            <span role="columnheader" className={styles.colNum}>通知</span>
            <span role="columnheader" className={styles.colFlex}>タイミング</span>
            <span role="columnheader" className={styles.colSent}>送った</span>
            <span role="columnheader" className={styles.colFail}>失敗</span>
            <span role="columnheader" className={styles.colNext}>次に送る</span>
          </div>
          {data.steps.map((step, index) => (
            <div key={step.id} role="row" className={styles.row}>
              <span role="cell" className={styles.colNum}>{step.stepNumber}</span>
              <span role="cell" className={styles.colFlex} title={stepLabel(step)}>{stepTiming(step, detailSteps[index], reminder?.deliveryMode)}</span>
              <span role="cell" className={styles.colSent}>{formatNumber(step.sent)}通</span>
              <span role="cell" className={styles.colFail} data-danger={step.errors > 0 || undefined}>{formatNumber(step.errors)}通</span>
              <span role="cell" className={styles.colNext}>{nextByStep ? formatMd(nextByStep[step.stepNumber] ?? null) : '—'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="rm-detail-recent">
        <div className={styles.cardHead}>
          <h2 id="rm-detail-recent" className={styles.cardTitle}>最近の実行</h2>
        </div>
        {recent.length === 0 && (data.items.length > 0 || data.pagination.total > data.items.length) ? (
          /* WEB084：先頭5件が予定ばかりで実行が見えないだけのときは「まだありません」と言わない。 */
          <p className={styles.cardNote}>
            最近の実行をここでは読み切れませんでした。{' '}
            <button type="button" className="font-semibold underline" onClick={onShowAllRuns}>実行結果で見る</button>
          </p>
        ) : recent.length === 0 ? (
          <p className={styles.cardNote}>まだ実行した通知はありません。届き始めるとここに出ます。</p>
        ) : (
          <>
            <div className={styles.table} role="table" aria-label="最近の実行">
              <div className={styles.headRow} role="row">
                <span role="columnheader" className={styles.colWhen}>時刻</span>
                <span role="columnheader" className={styles.colFlex}>友だち</span>
                <span role="columnheader" className={styles.colStep}>通知</span>
                <span role="columnheader" className={styles.colResult}>結果</span>
              </div>
              {recent.map((item) => (
                <div key={item.id} role="row" className={styles.row}>
                  <span role="cell" className={styles.colWhen}>{formatShort(item.completedAt ?? item.startedAt ?? item.scheduledAt)}</span>
                  <span role="cell" className={styles.colFlex}>
                    <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendName}>
                      {item.friendName ?? '削除済みの友だち'}
                    </Link>
                  </span>
                  <span role="cell" className={styles.colStep}>{item.stepNumber}</span>
                  <span role="cell" className={styles.colResult}>
                    <StatusPill tone={STATUS_VIEW[item.domainStatus].tone}>{STATUS_VIEW[item.domainStatus].label}</StatusPill>
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.moreRow}>
              <Button variant="text" onClick={onShowAllRuns}>
                <ArrowRight size={15} aria-hidden="true" />すべての実行結果
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  )
}

/* ===== 配信予定タブ ===== */

function ScheduleTab({ reminderId, steps }: { reminderId: string; steps: ReminderDeliveryRunsResponse['steps'] }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<ReminderDeliveryRun[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  const stepNameByNumber = useMemo(() => Object.fromEntries(steps.map((step) => [step.stepNumber, stepLabel(step)])), [steps])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await api.reminders.runs(reminderId, { status: 'planned', limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      if (!res.success) throw new Error(res.error)
      setItems(res.data.items)
      setTotal(res.data.pagination.total)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [page, reminderId])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  return (
    <section className={styles.card} aria-labelledby="rm-detail-schedule">
      <div className={styles.cardHead}>
        <h2 id="rm-detail-schedule" className={styles.cardTitle}>配信予定</h2>
        <p className={styles.cardNote}>これから送る通知を予定の近い順に並べています。</p>
      </div>
      {state === 'loading' ? (
        <ListState kind="loading" title="配信予定を読み込んでいます" />
      ) : state === 'error' ? (
        <ListState kind="error" title="配信予定を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <ListState kind="empty" emptyPreset="readonly" title="送る予定はありません" description="登録者の基準日が来ると、ここに送る予定が並びます。" />
      ) : (
        <>
          <div className={styles.table} role="table" aria-label="配信予定">
            <div className={styles.headRow} role="row">
              <span role="columnheader" className={styles.colNext}>送る日時</span>
              <span role="columnheader" className={styles.colFlex}>友だち</span>
              <span role="columnheader" className={styles.colWide}>通知</span>
              <span role="columnheader" className={styles.colResult}>状態</span>
            </div>
            {items.map((item) => (
              <div key={item.id} role="row" className={styles.row} data-warn={item.domainStatus === 'retry_wait' || undefined}>
                <span role="cell" className={styles.colNext}>
                  {formatMd(item.domainStatus === 'retry_wait' ? item.nextRetryAt : item.scheduledAt)}
                  {item.domainStatus === 'retry_wait' ? <span className={styles.cellSub}>再試行の予定</span> : null}
                </span>
                <span role="cell" className={styles.colFlex}>
                  <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendName}>{item.friendName ?? '削除済みの友だち'}</Link>
                </span>
                <span role="cell" className={styles.colWide} title={stepNameByNumber[item.stepNumber] ?? ''}>{item.stepNumber}通目</span>
                <span role="cell" className={styles.colResult}>
                  <StatusPill tone={STATUS_VIEW[item.domainStatus].tone}>{STATUS_VIEW[item.domainStatus].label}</StatusPill>
                </span>
              </div>
            ))}
          </div>
          <div className={styles.pager}>
            <span className={styles.pagerCount}>{formatNumber(total)}件中 {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="配信予定のページ送り" />
          </div>
        </>
      )}
    </section>
  )
}

/* ===== 実行結果タブ ===== */

const RUN_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'すべての結果' },
  { value: 'succeeded', label: '送れた' },
  { value: 'permanent_failed', label: '失敗' },
  { value: 'retry_wait', label: '再試行待ち' },
  { value: 'skipped', label: '送信なし' },
  { value: 'cancelled', label: '取り消し' },
  { value: 'planned', label: '配信予定' },
]

function RunsTab({ reminderId, canManage, initialStatus }: { reminderId: string; canManage: boolean; initialStatus: '' | ReminderDeliveryRunStatus }) {
  const [status, setStatus] = useState<'' | ReminderDeliveryRunStatus>(initialStatus)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<ReminderDeliveryRun[]>([])
  const [total, setTotal] = useState(0)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await api.reminders.runs(reminderId, {
        status: status || undefined,
        search: appliedSearch || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (!res.success) throw new Error(res.error)
      setItems(res.data.items)
      setTotal(res.data.pagination.total)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [appliedSearch, page, reminderId, status])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const retry = async (runId: string) => {
    setRetryingId(runId)
    setNotice('')
    try {
      const response = await api.reminders.retryRun(runId, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setNotice('再試行を受け付けました。次の配信処理で送ります。')
      await load()
    } catch {
      setNotice('再試行を受け付けられませんでした。状態を読み直してからお試しください。')
    } finally {
      setRetryingId(null)
    }
  }

  const filtered = Boolean(status || appliedSearch)

  return (
    <section className={styles.card} aria-labelledby="rm-detail-runs">
      <div className={styles.cardHead}>
        <h2 id="rm-detail-runs" className={styles.cardTitle}>実行結果</h2>
      </div>
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      <div className={styles.toolbar}>
        <SearchField
          className={styles.search}
          aria-label="友だちの名前で実行結果を検索"
          placeholder="友だちの名前で探す"
          value={search}
          onChange={setSearch}
          onClear={() => { setSearch(''); setAppliedSearch(''); setPage(1) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setAppliedSearch(search.trim())
              setPage(1)
            }
          }}
        />
        <Select aria-label="結果で絞り込む" value={status} onChange={(value) => { setStatus(value as '' | ReminderDeliveryRunStatus); setPage(1) }} options={RUN_STATUS_OPTIONS} />
        <Button onClick={() => { setAppliedSearch(search.trim()); setPage(1) }}>探す</Button>
      </div>
      {state === 'loading' ? (
        <ListState kind="loading" title="実行結果を読み込んでいます" />
      ) : state === 'error' ? (
        <ListState kind="error" title="実行結果を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          emptyPreset={filtered ? 'filtered' : 'readonly'}
          title={filtered ? undefined : 'まだ実行した通知はありません'}
          action={filtered ? <Button onClick={() => { setStatus(''); setSearch(''); setAppliedSearch(''); setPage(1) }}>条件を外す</Button> : undefined}
        />
      ) : (
        <>
          <div className={styles.table} role="table" aria-label="実行結果">
            <div className={styles.headRow} role="row">
              <span role="columnheader" className={styles.colWhen}>時刻</span>
              <span role="columnheader" className={styles.colFlex}>友だち</span>
              <span role="columnheader" className={styles.colStep}>通知</span>
              <span role="columnheader" className={styles.colResult}>結果</span>
              <span role="columnheader" className={styles.colReason}>詳細</span>
              <span role="columnheader" className={styles.colOps}><span className="sr-only">操作</span></span>
            </div>
            {items.map((item) => (
              <div key={item.id} role="row" className={styles.row}>
                <span role="cell" className={styles.colWhen}>
                  {formatShort(item.completedAt ?? item.startedAt ?? item.scheduledAt)}
                  {item.nextRetryAt ? <span className={styles.cellSub}>次回 {formatShort(item.nextRetryAt)}</span> : null}
                </span>
                <span role="cell" className={styles.colFlex}>
                  <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendName}>{item.friendName ?? '削除済みの友だち'}</Link>
                </span>
                <span role="cell" className={styles.colStep}>{item.stepNumber}通目</span>
                <span role="cell" className={styles.colResult}>
                  <StatusPill tone={STATUS_VIEW[item.domainStatus].tone}>{STATUS_VIEW[item.domainStatus].label}</StatusPill>
                </span>
                <span role="cell" className={styles.colReason} title={item.lastErrorMessage ?? undefined}>{item.lastErrorMessage ?? `${item.attemptCount}回試行`}</span>
                <span role="cell" className={styles.colOps}>
                  {item.canRetry && canManage ? (
                    <Button variant="text" disabled={retryingId === item.id} busy={retryingId === item.id} busyLabel="受け付けています" onClick={() => void retry(item.id)}>
                      <RotateCcw size={15} aria-hidden="true" />再試行する
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.pager}>
            <span className={styles.pagerCount}>{formatNumber(total)}件中 {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="実行結果のページ送り" />
          </div>
        </>
      )}
    </section>
  )
}

/* ===== 登録者タブ（loVfW） ===== */

type RegistrantFilter = 'all' | 'active' | 'cancelled'

function RegistrantsTab({ reminderId, canManage }: { reminderId: string; canManage: boolean }) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<ReminderRegistrant[]>([])
  const [draftDates, setDraftDates] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<RegistrantFilter>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const registrants = await api.reminders.registrants.list(reminderId)
      if (!registrants.success) throw new Error('load failed')
      setItems(registrants.data)
      setDraftDates(Object.fromEntries(registrants.data.map((item) => [item.id, dateTimeLocalJst(item.targetDate)])))
    } catch {
      setItems([])
      setError('登録者を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [reminderId])

  useEffect(() => {
    // アカウント切替直後に前の店舗の一覧を見せたままにしない。
    setItems([])
    setDraftDates({})
    void load()
  }, [load, selectedAccountId])

  const activeCount = useMemo(() => items.filter((item) => item.status === 'active').length, [items])
  const cancelledCount = items.filter((item) => item.status === 'cancelled').length

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter((item) => {
      if (filter === 'active' && item.status !== 'active') return false
      if (filter === 'cancelled' && item.status !== 'cancelled') return false
      if (needle && !(item.friendName ?? '').toLowerCase().includes(needle)) return false
      return true
    })
  }, [filter, items, search])

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const pageItems = visible.slice((page - 1) * pageSize, page * pageSize)

  const apply = (id: string, value: { targetDate: string; status: string; lockVersion: number }) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...value, updatedAt: new Date().toISOString() } as ReminderRegistrant : item))
    setDraftDates((current) => ({ ...current, [id]: dateTimeLocalJst(value.targetDate) }))
  }

  const saveDate = async (item: ReminderRegistrant) => {
    if (actioningId) return
    const local = draftDates[item.id]
    const targetDate = local ? dateTimeLocalJstToUtcIso(local) : null
    if (!targetDate) {
      setNotice('基準日を正しく入力してください。')
      return
    }
    setActioningId(item.id)
    setNotice('')
    try {
      const response = await api.reminders.registrants.updateTargetDate(reminderId, item.id, targetDate, item.lockVersion)
      if (!response.success) throw new Error(response.error)
      apply(item.id, response.data)
      setNotice(response.data.replayed ? '同じ変更を確認しました。基準日は変更済みです。' : '基準日を変更しました。未送信分だけ新しい日程で組み直します。')
    } catch {
      setNotice('基準日を変更できませんでした。ほかの担当者による変更がないか、一覧を読み直してください。')
    } finally { setActioningId(null) }
  }

  const changeStatus = async (item: ReminderRegistrant, action: 'cancel' | 'resume') => {
    if (actioningId) return
    setActioningId(item.id)
    setNotice('')
    try {
      const response = action === 'cancel'
        ? await api.reminders.registrants.cancel(reminderId, item.id, item.lockVersion)
        : await api.reminders.registrants.resume(reminderId, item.id, item.lockVersion)
      if (!response.success) throw new Error(response.error)
      apply(item.id, response.data)
      setNotice(action === 'cancel'
        ? '登録を取り消しました。送信済みの履歴は残り、未送信分だけを止めています。'
        : '登録を再開しました。未送信分だけを次の配信処理で組み直します。')
    } catch {
      setNotice('操作を完了できませんでした。一覧を読み直してからもう一度お試しください。')
    } finally { setActioningId(null) }
  }

  return (
    <>
      <p className={styles.infoBand}>
        <Info size={16} aria-hidden="true" className={styles.infoIcon} />
        基準日を変えると、まだ送っていない通知だけ新しい日程で組み直します。送った履歴は消えません。
      </p>

      <section className={styles.card} aria-labelledby="rm-detail-registrants">
        <div className={styles.cardHead}>
          <h2 id="rm-detail-registrants" className={styles.cardTitle}>登録者</h2>
          <p className={styles.cardNote}>{formatNumber(items.length)}人</p>
        </div>
        {notice ? <Notice tone="info">{notice}</Notice> : null}
        <div className={styles.toolbar}>
          <SearchField
            className={styles.search}
            aria-label="友だちの名前で登録者を検索"
            placeholder="友だちの名前で探す"
            value={search}
            onChange={(value) => { setSearch(value); setPage(1) }}
            onClear={() => { setSearch(''); setPage(1) }}
          />
          <FilterChip selected={filter === 'active'} onChange={(on) => { setFilter(on ? 'active' : 'all'); setPage(1) }}>
            {`有効 ${formatNumber(activeCount)}`}
          </FilterChip>
          <FilterChip selected={filter === 'cancelled'} onChange={(on) => { setFilter(on ? 'cancelled' : 'all'); setPage(1) }}>
            {`取消済み ${formatNumber(cancelledCount)}`}
          </FilterChip>
          <span className={styles.spacer} aria-hidden="true" />
          <PageSizeSelect value={pageSize} options={[10, 20, 50]} onChange={(value) => { setPageSize(value); setPage(1) }} />
        </div>

        {loading ? (
          <ListState kind="loading" title="登録者を読み込んでいます" />
        ) : error ? (
          <ListState kind="error" title="登録者を表示できませんでした" description={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <ListState kind="empty" emptyPreset="readonly" title="登録者はいません" description="このリマインダに登録すると、ここで基準日と状態を管理できます。" />
        ) : visible.length === 0 ? (
          <ListState kind="empty" emptyPreset="filtered" action={<Button onClick={() => { setSearch(''); setFilter('all'); setPage(1) }}>条件を外す</Button>} />
        ) : (
          <>
            <div className={styles.table} role="table" aria-label="登録者">
              <div className={styles.headRow} role="row">
                <span role="columnheader" className={styles.colFlex}>友だち</span>
                <span role="columnheader" className={styles.colDate}>基準日（予約日時）</span>
                <span role="columnheader" className={styles.colState}>状態</span>
                <span role="columnheader" className={styles.colOps}><span className="sr-only">操作</span></span>
              </div>
              {pageItems.map((item) => {
                const dirty = (draftDates[item.id] ?? '') !== dateTimeLocalJst(item.targetDate)
                const busy = actioningId === item.id
                return (
                  <div key={item.id} role="row" className={styles.row}>
                    <span role="cell" className={styles.colFlex}>
                      <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendLink}>{item.friendName || '名前未設定'}</Link>
                    </span>
                    <span role="cell" className={styles.colDate}>
                      <DateTimeField
                        className={styles.dateField}
                        aria-label={`${item.friendName || '登録者'}の基準日`}
                        value={draftDates[item.id] ?? ''}
                        disabled={item.status !== 'active' || busy || !canManage}
                        onChange={(v) => setDraftDates((current) => ({ ...current, [item.id]: v }))}
                      />
                    </span>
                    <span role="cell" className={styles.colState}>
                      <StatusPill tone={item.status === 'active' ? 'ok' : 'muted'}>
                        {item.status === 'active' ? '有効' : item.status === 'cancelled' ? '取消済み' : item.status}
                      </StatusPill>
                    </span>
                    <span role="cell" className={styles.colOps}>
                      {/* 閲覧のみの人には、押せない操作を置かない。 */}
                      {!canManage ? null : item.status === 'active' ? (
                        dirty ? (
                          <Button variant="primary" disabled={busy} busy={busy} busyLabel="保存しています" onClick={() => void saveDate(item)}>
                            <Check size={15} aria-hidden="true" />基準日を保存
                          </Button>
                        ) : (
                          <Button variant="text" disabled={busy} onClick={() => void changeStatus(item, 'cancel')}>
                            <X size={15} aria-hidden="true" />取り消す
                          </Button>
                        )
                      ) : item.status === 'cancelled' ? (
                        <Button variant="text" disabled={busy} onClick={() => void changeStatus(item, 'resume')}>
                          <RotateCcw size={15} aria-hidden="true" />再開する
                        </Button>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className={styles.pager}>
              <span className={styles.pagerCount}>{formatNumber(visible.length)}人中 {visible.length === 0 ? 0 : (page - 1) * pageSize + 1}〜{Math.min(page * pageSize, visible.length)}人</span>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="登録者のページ送り" />
            </div>
          </>
        )}
      </section>
    </>
  )
}
