'use client'

/*
 * ★V8 リマインダ詳細（絵 `rbAig` 概要）と登録者管理（絵 `loVfW`）。
 *
 * 読む口・操作の中身は v7 の detail/page.tsx と同じものを受け取る。
 * 並びは 戻るリンク＋題名＋1行説明 → タブ（概要・配信予定・実行結果・
 * 登録者）→ 左の本文／右の欄（一時停止・編集・その他 → いまの状態 →
 * 届き方のスマホ）。
 * 数は実値だけ出す。取れない値（公開前の実行記録など）は「—」ではなく
 * 0件・未取得として正直に出す。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { Reminder } from '@line-crm/shared'
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
import { usePageTitle } from '@/components/shell/page-chrome'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateTimeField from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import { Tabs } from '@/components/shared/tabs'
import {
  reminderTriggerLabel,
  renderReminderBodySample,
} from '@/components/reminders/reminder-labels'
import { formatDateTime, formatNumber } from '@/lib/format'
import { csvCell } from '@/lib/presentation'
import { PhoneMockV8, SummaryCardV8 } from '../wizard-v8-ui'
import styles from '../wizard-v8.module.css'
import detailStyles from './detail-v8.module.css'
import { dateTimeLocalJst, dateTimeLocalJstToUtcIso } from './registrants-panel'

const PAGE_SIZE = 20
/** 書き出しの上限。実行結果が多いとき、手元に全部ため込むと固まる。 */
const EXPORT_LIMIT = 5000
/** 配信予定タブで一度に取る件数。予定は近い順に返る。 */
const PLANNED_LIMIT = 100

const STATUS_VIEW: Record<ReminderDeliveryRunStatus, { label: string; warn?: boolean }> = {
  planned: { label: '配信予定' },
  claimed: { label: '送信処理中' },
  succeeded: { label: '送れた' },
  skipped: { label: '送信なし' },
  retry_wait: { label: '再試行待ち', warn: true },
  permanent_failed: { label: '失敗', warn: true },
  cancelled: { label: '取り消し' },
}

type DetailTab = 'overview' | 'schedule' | 'runs' | 'registrants'

function tabFromParam(value: string | null): DetailTab {
  if (value === 'schedule' || value === 'runs' || value === 'registrants') return value
  return 'overview'
}

/** 呼ぶたびに作ると行数分だけ重いため、外で1回作って使い回す (#489-19)。 */
function formatJst(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return formatDateTime(parsed)
}

function timingLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return '基準時刻'
  const abs = Math.abs(offsetMinutes)
  const before = offsetMinutes < 0
  if (abs % 1440 === 0) return `${abs / 1440}日${before ? '前' : '後'}`
  if (abs % 60 === 0) return `${abs / 60}時間${before ? '前' : '後'}`
  return `${abs}分${before ? '前' : '後'}`
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
  const searchParams = useSearchParams()
  const reminderId = searchParams.get('id') ?? ''
  const tab = tabFromParam(searchParams.get('tab'))
  const runsStatusParam = searchParams.get('runStatus')
  const { selectedAccount, selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canManage = canManageRole(staffRole)

  const [data, setData] = useState<ReminderDeliveryRunsResponse | null>(null)
  const [reminder, setReminder] = useState<Reminder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [duplicating, setDuplicating] = useState(false)

  usePageTitle(data?.reminder.name ? `${data.reminder.name}・リマインダ` : null)

  const load = useCallback(async () => {
    // idなしで帰ると「読み込んでいます」が永遠に出る。先に止めて文面を出す。
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

  const selectTab = (next: DetailTab) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('id', reminderId)
    params.set('tab', next)
    if (next !== 'runs') params.delete('runStatus')
    router.replace(`/reminders/detail?${params.toString()}`, { scroll: false })
  }

  /* ===== 状態を変える操作 ===== */

  // R146 監査：公開版の無い下書きは「停止中」ではなく「下書き」。再開は
  // 公開の経路に統一し、この画面からは出さない。
  const isUnpublishedDraft = data ? !data.reminder.hasPublishedVersion : false

  const setReminderActive = async (isActive: boolean) => {
    if (!data || data.reminder.isActive === isActive) return
    setActionMessage('')
    try {
      const response = await api.reminders.update(reminderId, { isActive })
      if (!response.success) throw new Error(response.error)
      setData((current) => current ? {
        ...current,
        reminder: { ...current.reminder, isActive },
      } : current)
      setActionMessage(isActive ? 'リマインダを再開しました。' : 'リマインダを一時停止しました。')
    } catch (caught) {
      // R146 監査：API も未公開の再開を 409 で止める。その文面をそのまま出す。
      setActionMessage(caught instanceof ApiError && caught.status === 409
        ? caught.message
        : isActive
          ? '再開できませんでした。状態を読み直してからお試しください。'
          : '一時停止できませんでした。状態を読み直してからお試しください。')
    }
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
      const settings = draft.data.settings
      const res = await api.reminders.createDraft({
        ...settings,
        name: `${data?.reminder.name ?? 'リマインダ'} のコピー`,
      })
      if (!res.success) throw new Error(res.error)
      const newId = String(res.data.reminderId)
      router.push(`/reminders/edit?id=${encodeURIComponent(newId)}&stage=target`)
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

  const menuItems: ActionMenuItem[] = [
    {
      id: 'csv',
      label: '実行結果をCSVで書き出す',
      icon: <Download size={15} aria-hidden="true" />,
      disabled: exporting || loading,
      onSelect: () => void exportCsv(),
    },
    {
      id: 'duplicate',
      label: '複製する',
      icon: <Copy size={15} aria-hidden="true" />,
      disabled: !canManage || duplicating,
      disabledReason: !canManage ? '編集する権限が要ります' : undefined,
      onSelect: () => void runDuplicate(),
    },
    {
      id: 'delete',
      label: '削除する',
      icon: <Trash2 size={15} aria-hidden="true" />,
      tone: 'danger',
      dividerBefore: true,
      disabled: !canManage,
      disabledReason: !canManage ? '削除する権限が要ります' : undefined,
      onSelect: () => setConfirmDelete(true),
    },
  ]

  const statusLabel = !data
    ? ''
    : !data.reminder.hasPublishedVersion
      ? '下書き'
      : data.reminder.isActive
        ? '稼働中'
        : '停止中'

  if (!reminderId) {
    return (
      <ListState
        kind="empty"
        title="リマインダが指定されていません"
        description="一覧から選び直してください。"
        action={<Button href="/reminders">リマインダ一覧へ戻る</Button>}
      />
    )
  }
  if (loading) {
    return <ListState kind="loading" title="リマインダの詳細を読み込んでいます" />
  }
  if (missing) {
    return (
      <ListState
        kind="empty"
        title="このリマインダは見つかりません"
        description="削除されたか、別の記録です。一覧から選び直してください。"
        action={<Button href="/reminders">リマインダ一覧へ戻る</Button>}
      />
    )
  }
  if (error || !data) {
    return (
      <ListState
        kind="error"
        title="詳細を表示できませんでした"
        description={error || '詳細を読み込めませんでした。'}
        onRetry={() => void load()}
      />
    )
  }

  const hasErrors = data.summary.errors > 0
  const firstStep = data.steps[0] ?? null

  return (
    <div className={styles.page}>
      <div className={styles.headText}>
        <Link href="/reminders" className={styles.backLink}>
          <ChevronLeft size={14} aria-hidden="true" />
          リマインダへ
        </Link>
        <h1 className={styles.headTitle}>{data.reminder.name}</h1>
        <p className={styles.headMeta}>
          {[
            reminder?.triggerType ? `基準日：${reminderTriggerLabel(reminder.triggerType)}` : null,
            `通知 ${data.steps.length}通`,
            reminder?.updatedAt ? `更新 ${formatJst(reminder.updatedAt)}` : null,
          ].filter(Boolean).join('・')}
        </p>
      </div>

      <Tabs
        label="リマインダの詳細"
        items={[
          { label: '概要', current: tab === 'overview', onClick: () => selectTab('overview') },
          { label: '配信予定', current: tab === 'schedule', onClick: () => selectTab('schedule') },
          { label: '実行結果', current: tab === 'runs', onClick: () => selectTab('runs') },
          { label: '登録者', current: tab === 'registrants', onClick: () => selectTab('registrants') },
        ]}
      />

      {actionMessage ? <Notice tone="info">{actionMessage}</Notice> : null}

      <div className={styles.cols}>
        <div className={styles.main}>
          {tab === 'overview' ? (
            <OverviewTab
              data={data}
              reminderId={reminderId}
              onShowErrors={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.set('id', reminderId)
                params.set('tab', 'runs')
                params.set('runStatus', 'permanent_failed')
                router.replace(`/reminders/detail?${params.toString()}`, { scroll: false })
              }}
              onShowAllRuns={() => selectTab('runs')}
            />
          ) : tab === 'schedule' ? (
            <ScheduleTab reminderId={reminderId} steps={data.steps} />
          ) : tab === 'runs' ? (
            <RunsTab
              // 概要の警告帳から飛んだとき、絞り込みを確実に掛け直す。
              key={runsStatusParam ?? ''}
              reminderId={reminderId}
              canManage={canManage}
              initialStatus={runsStatusParam === 'permanent_failed' ? 'permanent_failed' : ''}
            />
          ) : (
            <RegistrantsTab reminderId={reminderId} canManage={canManage} />
          )}
        </div>

        <aside className={styles.side}>
          <div className={styles.sideActions}>
            {isUnpublishedDraft ? null : data.reminder.isActive ? (
              <Button size="field" onClick={() => void setReminderActive(false)} disabled={!canManage}>
                一時停止する
              </Button>
            ) : (
              <Button size="field" onClick={() => void setReminderActive(true)} disabled={!canManage}>
                再開する
              </Button>
            )}
            <Button
              size="field"
              onClick={() => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}`)}
              disabled={!canManage}
            >
              <Pencil size={14} aria-hidden="true" />
              {isUnpublishedDraft ? '編集を続ける' : '編集する'}
            </Button>
            <button
              ref={menuButtonRef}
              type="button"
              className={detailStyles.menuButton}
              aria-label={`リマインダ「${data.reminder.name}」のその他の操作`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            <ActionMenu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              ariaLabel={`リマインダ「${data.reminder.name}」のその他の操作`}
              items={menuItems}
              anchorRef={menuButtonRef}
            />
          </div>

          <SummaryCardV8
            title="いまの状態"
            rows={[
              { key: '状態', value: statusLabel, strong: true },
              { key: '登録者', value: `${formatNumber(data.summary.targetCount)}人` },
              { key: 'これから送る（今後7日）', value: `${formatNumber(data.summary.scheduledNext7Days ?? 0)}通` },
              { key: '今月送った', value: `${formatNumber(data.summary.sentThisMonth ?? 0)}通` },
              { key: '失敗', value: `${formatNumber(data.summary.errors)}通`, danger: hasErrors },
            ]}
          />

          <div>
            <h2 className={styles.sideLabel}>届き方</h2>
            <PhoneMockV8
              accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
              chip={data.summary.nextScheduledAt ? `次は ${formatJst(data.summary.nextScheduledAt)} に届きます` : '次の送信予定はありません'}
              message={firstStep ? renderReminderBodySample(firstStep.messageContent || '本文はまだありません') : undefined}
              empty={!firstStep}
            />
          </div>
        </aside>
      </div>

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
    </div>
  )
}

/* ===== 概要タブ（rbAig） ===== */

function OverviewTab({
  data,
  reminderId,
  onShowErrors,
  onShowAllRuns,
}: {
  data: ReminderDeliveryRunsResponse
  reminderId: string
  onShowErrors: () => void
  onShowAllRuns: () => void
}) {
  /*
   * 「次に送る」は通知ごとの最早の予定。予定は別口（status=planned）で
   * 取って手順番号ごとに最小の scheduledAt を拾う。
   */
  const [nextByStep, setNextByStep] = useState<Record<number, string>>({})
  useEffect(() => {
    let cancelled = false
    void api.reminders.runs(reminderId, { status: 'planned', limit: PLANNED_LIMIT }).then((res) => {
      if (cancelled || !res.success) return
      const next: Record<number, string> = {}
      for (const item of res.data.items) {
        if (item.domainStatus !== 'planned' && item.domainStatus !== 'claimed' && item.domainStatus !== 'retry_wait') continue
        const at = item.domainStatus === 'retry_wait' ? item.nextRetryAt : item.scheduledAt
        if (!at) continue
        const current = next[item.stepNumber]
        if (!current || at < current) next[item.stepNumber] = at
      }
      setNextByStep(next)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [reminderId])

  const hasErrors = data.summary.errors > 0

  return (
    <>
      {hasErrors ? (
        <div className={detailStyles.warnBanner} role="alert">
          <AlertTriangle size={16} className={detailStyles.warnBannerIcon} aria-hidden="true" />
          <div className={detailStyles.warnBannerText}>
            <p className={detailStyles.warnBannerTitle}>送れなかった通知が {formatNumber(data.summary.errors)}通あります</p>
            <p className={detailStyles.warnBannerNote}>友だちがブロックしていたか、LINE が受け付けませんでした。理由を見て、送り直せます。</p>
          </div>
          <Button size="field" className={detailStyles.warnBannerAction} onClick={onShowErrors}>
            実行結果を見る
          </Button>
        </div>
      ) : null}

      <section className={styles.card} aria-label="通知ごとの送信状況">
        <h2 className={styles.cardTitle}>通知ごとの送信状況</h2>
        <p className={styles.cardNote}>LINEでは、友だち単位の既読は分かりません</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>通知</th>
              <th>タイミング</th>
              <th>送った</th>
              <th>失敗</th>
              <th>次に送る</th>
            </tr>
          </thead>
          <tbody>
            {data.steps.map((step) => (
              <tr key={step.id}>
                <td>{step.stepNumber}</td>
                <td>
                  <span className={styles.cellMain}>{timingLabel(step.offsetMinutes)}</span>
                  <span className={styles.cellSub}>{stepLabel(step)}</span>
                </td>
                <td>{formatNumber(step.sent)}通</td>
                <td className={step.errors > 0 ? styles.numDanger : undefined}>{formatNumber(step.errors)}通</td>
                <td>{formatJst(nextByStep[step.stepNumber] ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.card} aria-label="最近の実行">
        <h2 className={styles.cardTitle}>最近の実行</h2>
        {data.items.length === 0 ? (
          <p className={styles.cardNote}>まだ実行した通知はありません。届き始めるとここに出ます。</p>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>友だち</th>
                  <th>通知</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {data.items.slice(0, 5).map((item) => (
                  <tr key={item.id} className={item.domainStatus === 'permanent_failed' ? styles.rowWarn : undefined}>
                    <td>{formatJst(item.completedAt ?? item.startedAt ?? item.scheduledAt)}</td>
                    <td>
                      <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendLink}>
                        {item.friendName ?? '削除済みの友だち'}
                      </Link>
                    </td>
                    <td>{item.stepNumber}</td>
                    <td className={STATUS_VIEW[item.domainStatus].warn ? styles.stateWarn : styles.stateOk}>
                      {STATUS_VIEW[item.domainStatus].label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={detailStyles.moreRow}>
              <button type="button" className={detailStyles.moreLink} onClick={onShowAllRuns}>
                すべての実行結果
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </section>
    </>
  )
}

/* ===== 配信予定タブ ===== */

function ScheduleTab({
  reminderId,
  steps,
}: {
  reminderId: string
  steps: ReminderDeliveryRunsResponse['steps']
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<ReminderDeliveryRun[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  const stepNameByNumber = useMemo(
    () => Object.fromEntries(steps.map((step) => [step.stepNumber, stepLabel(step)])),
    [steps],
  )

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await api.reminders.runs(reminderId, {
        status: 'planned',
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
  }, [page, reminderId])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <section className={styles.card} aria-label="配信予定">
      <h2 className={styles.cardTitle}>配信予定</h2>
      <p className={styles.cardNote}>これから送る通知を予定の近い順に並べています。</p>
      {state === 'loading' ? (
        <ListState kind="loading" title="配信予定を読み込んでいます" />
      ) : state === 'error' ? (
        <ListState kind="error" title="配信予定を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          emptyPreset="readonly"
          title="送る予定はありません"
          description="登録者の基準日が来ると、ここに送る予定が並びます。"
        />
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>送る日時</th>
                <th>友だち</th>
                <th>通知</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.domainStatus === 'retry_wait' ? styles.rowWarn : undefined}>
                  <td>
                    <span className={styles.cellMain}>{formatJst(item.domainStatus === 'retry_wait' ? item.nextRetryAt : item.scheduledAt)}</span>
                    {item.domainStatus === 'retry_wait' ? <span className={styles.cellSub}>再試行の予定</span> : null}
                  </td>
                  <td>
                    <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendLink}>
                      {item.friendName ?? '削除済みの友だち'}
                    </Link>
                  </td>
                  <td>
                    <span className={styles.cellMain}>{item.stepNumber}通目</span>
                    <span className={styles.cellSub}>{stepNameByNumber[item.stepNumber] ?? ''}</span>
                  </td>
                  <td className={STATUS_VIEW[item.domainStatus].warn ? styles.stateWarn : styles.stateOk}>
                    {STATUS_VIEW[item.domainStatus].label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.pagerRow}>
            <span>{formatNumber(total)}件中 {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件</span>
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

function RunsTab({
  reminderId,
  canManage,
  initialStatus,
}: {
  reminderId: string
  canManage: boolean
  initialStatus: '' | ReminderDeliveryRunStatus
}) {
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

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

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

  return (
    <section className={styles.card} aria-label="実行結果">
      <h2 className={styles.cardTitle}>実行結果</h2>
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      <div className={styles.filterRow}>
        <SearchField
          className={detailStyles.searchGrow}
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
        <Select
          aria-label="結果で絞り込む"
          value={status}
          onChange={(value) => { setStatus(value as '' | ReminderDeliveryRunStatus); setPage(1) }}
          options={RUN_STATUS_OPTIONS}
        />
        <Button size="field" onClick={() => { setAppliedSearch(search.trim()); setPage(1) }}>
          探す
        </Button>
      </div>
      {state === 'loading' ? (
        <ListState kind="loading" title="実行結果を読み込んでいます" />
      ) : state === 'error' ? (
        <ListState kind="error" title="実行結果を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          emptyPreset={status || appliedSearch ? 'filtered' : 'readonly'}
          title={status || appliedSearch ? undefined : 'まだ実行した通知はありません'}
          action={status || appliedSearch ? (
            <Button size="field" onClick={() => { setStatus(''); setSearch(''); setAppliedSearch(''); setPage(1) }}>
              条件を外す
            </Button>
          ) : undefined}
        />
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>時刻</th>
                <th>友だち</th>
                <th>通知</th>
                <th>結果</th>
                <th>詳細</th>
                <th><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.domainStatus === 'permanent_failed' ? styles.rowWarn : undefined}>
                  <td>
                    <span className={styles.cellMain}>{formatJst(item.completedAt ?? item.startedAt ?? item.scheduledAt)}</span>
                    {item.nextRetryAt ? <span className={styles.cellSub}>次回 {formatJst(item.nextRetryAt)}</span> : null}
                  </td>
                  <td>
                    <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendLink}>
                      {item.friendName ?? '削除済みの友だち'}
                    </Link>
                  </td>
                  <td>{item.stepNumber}通目</td>
                  <td className={STATUS_VIEW[item.domainStatus].warn ? styles.stateWarn : styles.stateOk}>
                    {STATUS_VIEW[item.domainStatus].label}
                  </td>
                  <td>
                    <span className={styles.cellSub}>
                      {item.lastErrorMessage ?? `${item.attemptCount}回試行`}
                    </span>
                  </td>
                  <td>
                    {item.canRetry && canManage ? (
                      <Button
                        size="field"
                        disabled={retryingId === item.id}
                        busy={retryingId === item.id}
                        busyLabel="再試行を受け付けています"
                        onClick={() => void retry(item.id)}
                      >
                        再試行する
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.pagerRow}>
            <span>{formatNumber(total)}件中 {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件</span>
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
    if (!reminderId) {
      setError('リマインダが指定されていません。一覧から選び直してください。')
      setLoading(false)
      return
    }
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
  const cancelledCount = items.length - activeCount

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
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  const pageItems = visible.slice((page - 1) * pageSize, page * pageSize)

  const apply = (id: string, value: { targetDate: string; status: string; lockVersion: number }) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...value, updatedAt: new Date().toISOString() } : item))
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
      <div className={styles.bannerInfo}>
        基準日を変えると、まだ送っていない通知だけ新しい日程で組み直します。送った履歴は消えません。
      </div>

      <section className={styles.card} aria-label="登録者">
        <h2 className={styles.cardTitle}>登録者 <span className={styles.cardNote}>{formatNumber(items.length)}人</span></h2>
        {notice ? <Notice tone="info">{notice}</Notice> : null}
        <div className={styles.filterRow}>
          <SearchField
            className={detailStyles.searchGrow}
            aria-label="友だちの名前で登録者を検索"
            placeholder="友だちの名前で探す"
            value={search}
            onChange={(value) => { setSearch(value); setPage(1) }}
            onClear={() => { setSearch(''); setPage(1) }}
          />
          <button
            type="button"
            className={[styles.filterChip, filter === 'active' ? styles.filterChipOn : ''].filter(Boolean).join(' ')}
            aria-pressed={filter === 'active'}
            onClick={() => { setFilter(filter === 'active' ? 'all' : 'active'); setPage(1) }}
          >
            有効 {formatNumber(activeCount)}
          </button>
          <button
            type="button"
            className={[styles.filterChip, filter === 'cancelled' ? styles.filterChipOn : ''].filter(Boolean).join(' ')}
            aria-pressed={filter === 'cancelled'}
            onClick={() => { setFilter(filter === 'cancelled' ? 'all' : 'cancelled'); setPage(1) }}
          >
            取消済み {formatNumber(cancelledCount)}
          </button>
          <PageSizeSelect value={pageSize} onChange={(value) => { setPageSize(value); setPage(1) }} />
        </div>

        {loading ? (
          <ListState kind="loading" title="登録者を読み込んでいます" />
        ) : error ? (
          <ListState kind="error" title="登録者を表示できませんでした" description={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <ListState
            kind="empty"
            emptyPreset="readonly"
            title="登録者はいません"
            description="このリマインダに登録すると、ここで基準日と状態を管理できます。"
          />
        ) : visible.length === 0 ? (
          <ListState
            kind="empty"
            emptyPreset="filtered"
            action={
              <Button size="field" onClick={() => { setSearch(''); setFilter('all'); setPage(1) }}>
                条件を外す
              </Button>
            }
          />
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>友だち</th>
                  <th>基準日（予約日時）</th>
                  <th>状態</th>
                  <th><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => {
                  const dirty = (draftDates[item.id] ?? '') !== dateTimeLocalJst(item.targetDate)
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/friends/${encodeURIComponent(item.friendId)}`} className={styles.friendLink}>
                          {item.friendName || '名前未設定'}
                        </Link>
                      </td>
                      <td>
                        <DateTimeField
                          aria-label={`${item.friendName || '登録者'}の基準日`}
                          value={draftDates[item.id] ?? ''}
                          disabled={item.status !== 'active' || actioningId === item.id || !canManage}
                          onChange={(v) => setDraftDates((current) => ({ ...current, [item.id]: v }))}
                        />
                      </td>
                      <td>
                        <span className={[styles.statusDot, item.status === 'active' ? styles.statusDotOk : ''].filter(Boolean).join(' ')}>
                          {item.status === 'active' ? '有効' : item.status === 'cancelled' ? '取消済み' : item.status}
                        </span>
                      </td>
                      <td>
                        {item.status === 'active' ? (
                          dirty ? (
                            <Button
                              size="field"
                              variant="primary"
                              disabled={actioningId === item.id || !canManage}
                              busy={actioningId === item.id}
                              busyLabel="保存しています"
                              onClick={() => void saveDate(item)}
                            >
                              基準日を保存
                            </Button>
                          ) : (
                            <Button
                              size="field"
                              disabled={actioningId === item.id || !canManage}
                              onClick={() => void changeStatus(item, 'cancel')}
                            >
                              取り消す
                            </Button>
                          )
                        ) : item.status === 'cancelled' ? (
                          <Button
                            size="field"
                            disabled={actioningId === item.id || !canManage}
                            onClick={() => void changeStatus(item, 'resume')}
                          >
                            再開する
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className={styles.pagerRow}>
              <span>{formatNumber(visible.length)}人中 {visible.length === 0 ? 0 : (page - 1) * pageSize + 1}〜{Math.min(page * pageSize, visible.length)}人</span>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="登録者のページ送り" />
            </div>
          </>
        )}
      </section>
    </>
  )
}
