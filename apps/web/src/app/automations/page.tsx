'use client'

import SelectField from '@/components/shared/select-field'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { MoreHorizontal } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import AutomationTemplateGallery from '@/components/automations/automation-template-gallery'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import { usePageTitle } from '@/components/shell/page-chrome'
import FilterChip from '@/components/shared/filter-chip'
import KpiCollapse from '@/components/ui/kpi-collapse'
import MetricValue from '@/components/ui/metric-value'
import {
  automationActionLabel,
  automationTriggerLabel,
  type Automation as SharedAutomation,
  type AutomationEventType,
} from '@line-crm/shared'

type LoadStatus = 'loading' | 'ready' | 'error'

interface Automation extends SharedAutomation {
  // null = global automation (fires for every account); UUID = bound to that
  // account. Surfaced so the badge + toggle/delete guards can distinguish.
  lineAccountId: string | null
  triggerConfig: Record<string, unknown>
  status: 'draft' | 'active' | 'stopped'
  versionId: string
  version: number
  executionCount30d: number
  failureCount30d: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

const eventTypeBadgeColor: Record<AutomationEventType, string> = {
  friend_add: 'bg-success-bg text-success',
  tag_change: 'bg-blue-100 text-blue-700',
  score_threshold: 'bg-warning-bg text-yellow-700',
  cv_fire: 'bg-red-100 text-danger',
  message_received: 'bg-purple-100 text-purple-700',
  postback_received: 'bg-pink-100 text-pink-700',
  calendar_booked: 'bg-indigo-100 text-indigo-700',
  form_submitted: 'bg-violet-100 text-violet-700',
  link_clicked: 'bg-fuchsia-100 text-fuchsia-700',
  datetime: 'bg-lime-100 text-success',
  daily: 'bg-amber-100 text-amber-700',
  weekly: 'bg-sky-100 text-sky-700',
  'ec.order.confirmed': 'bg-emerald-100 text-success',
  'ec.order.shipped': 'bg-cyan-100 text-cyan-700',
  'ec.subscription.upcoming': 'bg-teal-100 text-teal-700',
  'ec.subscription.payment_failed': 'bg-orange-100 text-orange-700',
  'ec.subscription.cancelled': 'bg-slate-100 text-slate-700',
}

/**
 * 確認窓が預かっている操作。
 *
 * `accountId` は**押した時点で選んでいたLINEアカウント**。窓を開けたまま
 * ヘッダーでアカウントを切り替えられるので、切り替わったことを窓の中で
 * 知らせて選び直させる。黙って閉じると「押したのに何も起きない」になる。
 */
type PendingAction = {
  kind: 'toggle' | 'archive'
  automation: Automation
  accountId: string | null
}

type AutomationActionLock = {
  tryAcquire: () => boolean
  release: () => void
}

/** React の再描画より先に連打を止める、画面内だけの単一実行ロック。 */
function createAutomationActionLock(): AutomationActionLock {
  let locked = false
  return {
    tryAcquire: () => {
      if (locked) return false
      locked = true
      return true
    },
    release: () => { locked = false },
  }
}

/**
 * 一覧操作を1回だけ実行し、その操作を始めたアカウントが表示中なら再取得する。
 * APIが失敗しても再取得し、サーバへ届いたか分からない表示を残さない。
 */
async function performAutomationAction({
  lock,
  actionAccountId,
  getSelectedAccountId,
  request,
  reload,
  onStart,
  onFinish,
}: {
  lock: AutomationActionLock
  actionAccountId: string | null
  getSelectedAccountId: () => string | null
  request: () => Promise<void>
  reload: () => Promise<void>
  onStart: () => void
  onFinish: () => void
}): Promise<'completed' | 'ignored'> {
  if (actionAccountId !== getSelectedAccountId() || !lock.tryAcquire()) return 'ignored'
  onStart()
  try {
    await request()
    if (getSelectedAccountId() === actionAccountId) await reload()
    return 'completed'
  } catch (error) {
    if (getSelectedAccountId() === actionAccountId) await reload()
    throw error
  } finally {
    lock.release()
    onFinish()
  }
}

/**
 * 「編集用の下書き」を作れなかった理由を、失敗の種類で分けて運用者の言葉に
 * する（AUTOMATION-05）。
 *
 *   - 403 … 権限やアカウント範囲の不足。再押しでは直らないので、権限の確認を促す。
 *   - 404 … ルールが消えた・別アカウント・範囲外。一覧の読み直しが先。
 *   - 409 … ほかの変更と重なった。読み直してからの再試行が効く。
 *   - それ以外（5xx・通信切れ）… 時間をおいて再試行。
 */
function describeAutomationEditFailure(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.status) {
      case 401:
        return 'ログインの状態が切れています。ログインし直してから、もう一度お試しください。'
      case 403:
        return 'このルールを編集する権限がありません。選んでいるアカウントと権限を確認してください。'
      case 404:
        return 'ルールが見つかりませんでした。削除されたか、別のLINEアカウントのルールです。一覧を読み直しました。'
      case 409:
        return 'ほかの人の変更と重なりました。一覧を読み直してから、もう一度お試しください。'
      default:
        return caught.status >= 500
          ? 'サーバー側で編集用の下書きを作れませんでした。時間をおいて、もう一度お試しください。'
          : '編集用の下書きを作れませんでした。もう一度お試しください。'
    }
  }
  return '編集用の下書きを作れませんでした。通信状態を確かめて、もう一度お試しください。'
}

function AutomationRowActions({
  automation,
  canManage,
  busy,
  onToggle,
  onEdit,
  onDuplicate,
  onArchive,
  onViewRuns,
}: {
  automation: Automation
  canManage: boolean | null
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onViewRuns: () => void
}) {
  // #641: 「編集」＋「その他（…）」の形にそろえ、複製・止める・保管はメニューへ集約。
  const [menuOpen, setMenuOpen] = useState(false)
  /*
   * #670 25: 「編集する」「動いた記録を見る」の2ボタンが折返しで縦に積まれ、
   * 行の高さを押し上げていた。記録はメニュー先頭へ移し、行の操作は1行に収める。
   * 閲覧のみには記録ボタンを残す(#677 N-352の見るだけ導線)。
   */
  const runsHref = `/automations/runs?search=${encodeURIComponent(automation.name)}`
  return (
    <div className="relative flex flex-wrap items-center justify-end gap-1.5">
      {canManage ? (
        <>
          {/* #942 N-352: 編集・複製・保管を行から直接開けるようにする。 */}
          <Button onClick={onEdit} disabled={busy} variant="secondary" className="whitespace-nowrap">編集する</Button>
          <IconButton
            aria-label={`${automation.name}のその他操作`}
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal aria-hidden />
          </IconButton>
          <ActionMenu
            open={menuOpen}
            ariaLabel={`${automation.name}の操作`}
            onClose={() => setMenuOpen(false)}
            items={[
              {
                id: 'runs',
                label: '動いた記録を見る',
                disabled: busy,
                onSelect: onViewRuns,
              },
              {
                id: 'duplicate',
                label: '複製する',
                disabled: busy,
                onSelect: onDuplicate,
              },
              ...(automation.status === 'draft'
                ? []
                : [{
                    id: 'toggle',
                    label: '止める・動かす',
                    disabled: busy,
                    onSelect: onToggle,
                  }]),
              {
                id: 'archive',
                label: '保管する',
                disabled: busy,
                onSelect: onArchive,
              },
            ]}
          />
        </>
      ) : canManage === false ? (
        <>
          <Button href={runsHref} variant="secondary" className="whitespace-nowrap">動いた記録を見る</Button>
          <span className="text-xs text-ink-faint">操作する権限がありません</span>
        </>
      ) : null}
    </div>
  )
}

function conditionLabel(conditions: Record<string, unknown>): string {
  const keyword = typeof conditions.keyword === 'string' ? conditions.keyword.trim() : ''
  if (keyword) return `「${keyword}」を含む人`
  if (Object.keys(conditions).length === 0) return '条件なし'
  return '登録した条件'
}

/*
  設計 `gief7` のタブ帯。**「見本」は別の画面ではなく、同じ帯の中の1本。**
  台帳の `WjYAC`（25-1-C 見本から作る）は `/automations?tab=templates` を指しているが、
  これまで画面にタブが無く、`?tab=` を付けても一覧が出るだけだった。
*/
const MERGED_TABS = [
  { key: 'active', label: '動いているもの' },
  { key: 'stopped', label: '止めているもの' },
  { key: 'runs', label: '動いた記録', href: '/automations/runs' },
  { key: 'templates', label: '見本' },
  { key: 'common-actions', label: '共通アクション', href: '/common-actions' },
]

/** 一覧の1ページぶん。口は全件返すので、ここで切り出す。 */
const AUTOMATION_PAGE_SIZE = 6

export default function AutomationsPage() {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const tab = useMergedTab(MERGED_TABS)
  usePageTitle(tab === 'templates' ? '見本から作る' : 'オートメーション')
  const canManageAutomations = useCanManageAutomations()
  /*
   * 閲覧のみの利用者（N-361、要件 §4-1・§4-9）。
   *
   * `null` は権限を読み終わる前。共通アクション一覧と同じく、読めるまでは
   * 操作を出さない。`false` と分かった行・帯だけ理由を1行出す。
   */
  const viewerOnly = canManageAutomations === false
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らないので、確認の絵をそもそも撮れない。何が止まり・
   * 何が残り・戻せるのかを本文で読ませたいので、共通の `ConfirmDialog`
   * へ移した。
   */
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)
  /** 編集・複製で画面を抜ける最中の行。連打で2回呼ばないための表示用。 */
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [automaticRuns, setAutomaticRuns] = useState<number | null>(null)
  const [failedRuns, setFailedRuns] = useState<number | null>(null)
  const [estimatedHoursSaved, setEstimatedHoursSaved] = useState<number | null>(null)
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [commonActionCount, setCommonActionCount] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'stopped'>('all')
  const [sortOrder, setSortOrder] = useState<'runs' | 'priority' | 'name'>('runs')
  const [page, setPage] = useState(1)
  /** 押したあとにアカウントが変わったか。変わっていたら実行させない。 */
  const accountChanged = pending !== null && pending.accountId !== selectedAccountId
  const loadRequestRef = useRef(0)
  /*
   * state の反映を待つ一瞬にも2回目を通さないための同期ロック。
   * `working` は表示用、こちらは同じクリック列からAPIを1回だけ呼ぶために使う。
   */
  const actionLockRef = useRef(createAutomationActionLock())
  /* 実行中にアカウントが切り替わったとき、古い一覧を新しい画面へ戻さない。 */
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId

  const loadAutomations = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setError('')
    try {
      const [res, templatesResponse, commonActionsResponse] = await Promise.all([
        api.automations.list({ accountId: selectedAccountId || undefined }),
        selectedAccountId
          ? api.automations.templates(selectedAccountId).catch(() => null)
          : Promise.resolve(null),
        selectedAccountId
          ? api.commonActions.list({ accountId: selectedAccountId }).catch(() => null)
          : Promise.resolve(null),
      ])
      if (requestId !== loadRequestRef.current) return
      if (res.success) {
        setAutomations(res.data)
        const executions = res.summary?.executionCount30d ?? null
        setAutomaticRuns(executions)
        setFailedRuns(res.summary?.failureCount30d ?? null)
        setEstimatedHoursSaved(executions === null ? null : Math.round(executions / 120))
        setLoadStatus('ready')
      } else {
        setAutomations([])
        setAutomaticRuns(null)
        setFailedRuns(null)
        setEstimatedHoursSaved(null)
        setLoadStatus('error')
      }
      setTemplateCount(templatesResponse?.success ? templatesResponse.data.length : null)
      setCommonActionCount(commonActionsResponse?.success ? commonActionsResponse.data.length : null)
    } catch {
      if (requestId !== loadRequestRef.current) return
      setAutomations([])
      setLoadStatus('error')
      setAutomaticRuns(null)
      setFailedRuns(null)
      setEstimatedHoursSaved(null)
      setTemplateCount(null)
      setCommonActionCount(null)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return

    void loadAutomations()

    return () => {
      // アカウント切替前の遅い応答を、次のアカウントの一覧へ混ぜない。
      loadRequestRef.current += 1
    }
  }, [accountLoading, loadAutomations])

  /** 稼働の入れ替えそのもの。返事を確かめてから呼び出し元に戻す。 */
  const applyToggle = async (target: Automation) => {
    // #942 N-352: V6の定義の状態を直接切り替える。旧 automations 表への
    // PUT では V6 の行に届かないため、定義の状態遷移の口を使う。
    const res = await api.automations.setStatus(target.id, target.isActive ? 'stopped' : 'active')
    if (!res.success) throw new Error(res.error)
  }

  /*
   * 稼働の切り替えはすべて確認窓を経由する（要件 §4-1、N-360）。
   *
   * 通常ルールだけ直接PUTを投げていたため、二重押しで ON→OFF→ON と往復し、
   * 最終状態が意図と逆になり得た。窓の `runPending` は処理中の再受け付けを
   * 止めているので、ここでは投げずに窓へ預けるだけにする。
   * 全アカウント共通のルールは窓の中で注意書きを出す（下のダイアログ）。
   */
  const handleToggleActive = (target: Automation) => {
    setActionError('')
    setPending({ kind: 'toggle', automation: target, accountId: selectedAccountId })
  }

  /**
   * #942 N-352: 「保管」は削除の代わり。実行記録は残し、一覧から隠すだけ。
   * 元に戻せない一方通行なので、稼働切替と同じく確認窓を経由する。
   */
  const handleArchive = (target: Automation) => {
    setActionError('')
    setPending({ kind: 'archive', automation: target, accountId: selectedAccountId })
  }

  /**
   * 「編集」は確認なしで進めてよい。公開版を写した改訂用の下書きを
   * ぶら下げて（すでにあればそれを使う）、その下書きの編集面を開く。
   *
   * 失敗は種類で案内を分ける（AUTOMATION-05）。「作れませんでした」の1文だと
   * 権限不足・消えたルール・通信切れを区別できず、できるはずの再試行や
   * 一覧の読み直しへ進めない。404・409 は一覧が古い可能性があるので読み直す。
   */
  const handleEdit = async (target: Automation) => {
    if (rowBusyId) return
    setActionError('')
    setError('')
    setRowBusyId(target.id)
    const accountId = selectedAccountId
    try {
      const res = await api.automations.createDraftFromAutomation(target.id)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountIdRef.current !== accountId) return
      router.push(`/automations/drafts?id=${encodeURIComponent(res.data.id)}`)
    } catch (caught) {
      if (selectedAccountIdRef.current === accountId) {
        setError(describeAutomationEditFailure(caught))
        if (caught instanceof ApiError && (caught.status === 404 || caught.status === 409)) {
          void loadAutomations()
        }
      }
    } finally {
      setRowBusyId(null)
    }
  }

  /**
   * 「複製」も確認なしで進める。新しい下書きとして増えるだけで、
   * 元のルールも実行記録も変わらない。できた複製の編集面を開く。
   */
  const handleDuplicate = async (target: Automation) => {
    if (rowBusyId) return
    setActionError('')
    setError('')
    setRowBusyId(target.id)
    const accountId = selectedAccountId
    try {
      const res = await api.automations.duplicate(target.id)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountIdRef.current !== accountId) return
      router.push(`/automations/drafts?id=${encodeURIComponent(res.data.id)}`)
    } catch {
      if (selectedAccountIdRef.current === accountId) {
        setError('複製できませんでした。状態を読み直してから、もう一度お試しください。')
      }
    } finally {
      setRowBusyId(null)
    }
  }

  /**
   * 窓の中の「実行する」。
   *
   * 処理中は受け付けない（二度押しで2回消えると、消えたことに気づけない）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。生のAPIエラーは
   * 「Internal server error」のように、運用者が次に何をすればよいか
   * 読み取れない。
   */
  const runPending = async () => {
    if (!pending) return
    const action = pending
    try {
      const result = await performAutomationAction({
        lock: actionLockRef.current,
        actionAccountId: action.accountId,
        getSelectedAccountId: () => selectedAccountIdRef.current,
        request: async () => {
          if (action.kind === 'archive') {
            const res = await api.automations.setStatus(action.automation.id, 'archived')
            if (!res.success) throw new Error(res.error)
          } else {
            await applyToggle(action.automation)
          }
        },
        reload: loadAutomations,
        onStart: () => {
          setWorking(true)
          setActionError('')
        },
        onFinish: () => setWorking(false),
      })
      if (result === 'ignored') return
      setPending(null)
    } catch {
      setActionError(
        action.kind === 'archive'
          ? 'このルールを保管できませんでした。状態を読み直してから、もう一度お試しください。'
          : '稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。',
      )
    }
  }

  if (tab === 'templates') {
    const activeCount = loadStatus === 'ready' ? automations.filter((item) => item.isActive).length : null
    const stoppedCount = loadStatus === 'ready' ? automations.filter((item) => !item.isActive).length : null
    const tabs = MERGED_TABS.map((item) => ({
      ...item,
      label: item.key === 'active'
        ? `動いているもの ${activeCount ?? '—'}`
        : item.key === 'stopped'
          ? `止めているもの ${stoppedCount ?? '—'}`
          : item.key === 'templates'
            ? `見本 ${templateCount ?? '—'}`
            : item.key === 'common-actions'
              ? `共通アクション ${commonActionCount ?? '—'}`
              : item.label,
    }))
    return (
      <div data-design-node="WjYAC">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-faint">自動化 ＞ オートメーション ＞ 見本</p>
          {/* 作成は owner/admin だけ（N-361）。見本の閲覧と「これで作る」の出し分けは画廊側で行う。 */}
          {canManageAutomations ? <Button href="/automations/new">ルールを作成</Button> : null}
        </div>
        <div className="mb-4">
          <MergedTabs basePath="/automations" paramName="tab" tabs={tabs} active={tab} />
        </div>
        <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info">
          見本を選ぶと、そのまま「つくる」画面が開きます。中身は自由に直せます。よく使われている順に並べています。
        </div>
        <AutomationTemplateGallery accountId={selectedAccountId} canManage={canManageAutomations} />
        <style jsx global>{`
          [data-design-node="WjYAC"] [aria-label="きっかけで絞り込む"] { display: none; }
          [data-design-node="WjYAC"] [data-automation-template-gallery="v6"] > div:first-child {
            display: none;
          }
          [data-design-node="WjYAC"] [data-automation-template-gallery="v6"] article:nth-of-type(n + 10) {
            display: none;
          }
          [data-design-node="WjYAC"] [data-automation-template-gallery="v6"] article {
            padding: 16px;
          }
          [data-design-node="WjYAC"] [data-automation-template-gallery="v6"] article p {
            display: none;
          }
          [data-design-node="WjYAC"] [data-automation-template-gallery="v6"] article button {
            width: auto;
            margin-left: auto;
          }
        `}</style>
      </div>
    )
  }

  const activeCount = loadStatus === 'ready' ? automations.filter((item) => item.isActive).length : null
  const stoppedCount = loadStatus === 'ready' ? automations.filter((item) => !item.isActive).length : null
  const tabs = MERGED_TABS.map((item) => ({
    ...item,
    label: item.key === 'active'
      ? `動いているもの ${activeCount ?? '—'}`
      : item.key === 'stopped'
        ? `止めているもの ${stoppedCount ?? '—'}`
        : item.key === 'templates'
          ? `見本 ${templateCount ?? '—'}`
          : item.key === 'common-actions'
            ? `共通アクション ${commonActionCount ?? '—'}`
            : item.label,
  }))
  const visibleAutomations = (() => {
    const requestedStatus = tab === 'stopped' ? 'stopped' : statusFilter
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja')
    return automations
      .filter((item) => requestedStatus === 'all' || (requestedStatus === 'active' ? item.isActive : !item.isActive))
      .filter((item) => {
        if (!normalizedQuery) return true
        const actions = item.actions.map((action) => automationActionLabel(action.type)).join(' ')
        return `${item.name} ${item.description ?? ''} ${automationTriggerLabel(item.eventType)} ${actions}`
          .toLocaleLowerCase('ja')
          .includes(normalizedQuery)
      })
      .sort((a, b) => sortOrder === 'name'
        ? a.name.localeCompare(b.name, 'ja')
        : sortOrder === 'runs'
          // 「動いた回数が多い順」はこの30日の実績で並べる。
          // 同数は名前順に寄せて、開くたびに順番が変わらないようにする。
          ? b.executionCount30d - a.executionCount30d || a.name.localeCompare(b.name, 'ja')
          : b.priority - a.priority || a.name.localeCompare(b.name, 'ja'))
  })()
  const listPageCount = Math.max(1, Math.ceil(visibleAutomations.length / AUTOMATION_PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), listPageCount)
  const pagedAutomations = visibleAutomations.slice(
    (currentPage - 1) * AUTOMATION_PAGE_SIZE,
    currentPage * AUTOMATION_PAGE_SIZE,
  )

  return (
    <div>
      <div className="mb-4">
        <MergedTabs basePath="/automations" paramName="tab" tabs={tabs} active={tab} />
      </div>
      <div data-design="Head" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-faint">自動化 ＞ オートメーション</p>
        <div className="flex flex-wrap gap-2">
          <Button href="/common-actions">共通アクションを見る</Button>
          <Button href="/automations?tab=templates">見本から作る</Button>
          {/* 作成は owner/admin だけ。閲覧のみには出さず、下で理由を出す（N-361）。 */}
          {canManageAutomations ? <Button href="/automations/new" variant="primary">ルールを作成</Button> : null}
          <Button href="/support">マニュアル</Button>
        </div>
      </div>
      {viewerOnly ? (
        <p className="mb-4 rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm text-ink-secondary" role="note">
          閲覧のみのため、ルールの作成・変更はできません。操作する権限がありません。
        </p>
      ) : null}

      <p className="mb-4 text-sm text-ink-faint">「〜のとき、〜する」を登録して自動で実行します。友だち一覧から手で実行したり、毎日決まった時刻に動かすこともできます。</p>
      <p className="sr-only">共通アクションは友だち一覧からの手動実行にも使えます。</p>

      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse data-design="KPIs" className="mb-4" gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">動いているもの</p>
          <p className="text-ink mt-1 text-2xl font-bold">
            {/* 監査6 #674: 数字の見せ方は MetricValue に寄せる */}
            <MetricValue value={activeCount} unit="本" />
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">稼働中 {activeCount ?? '—'}本・止めているもの {stoppedCount ?? '—'}本</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月の実行（この30日）</p>
          <p className="text-ink mt-1 text-2xl font-bold"><MetricValue value={automaticRuns ?? null} unit="回" /></p>
          <p className="text-ink-faint mt-0.5 text-xs">分析の「使われ方」と同じ集計</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">失敗した</p>
          <p className="text-ink mt-1 text-2xl font-bold"><MetricValue value={failedRuns ?? null} unit="回" /></p>
          <p className="text-ink-faint mt-0.5 text-xs">部分成功を含む・この30日</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">減らせた手作業</p>
          <p className="text-ink mt-1 text-2xl font-bold"><MetricValue value={estimatedHoursSaved} prefix="およそ" unit="時間" /></p>
          <p className="text-ink-faint mt-0.5 text-xs">1回30秒として計算しています</p>
        </div>
      </KpiCollapse>

      <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info">
        上から順に見て、当てはまったものが動きます。同じきっかけで2本が当てはまると両方が動くため、片方だけにしたいときは条件をずらしてください。
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => { setSearchQuery(event.target.value); setPage(1) }}
          placeholder="ルール名・きっかけ・することで検索"
          className="h-10 w-full max-w-lg rounded-control border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-info"
        />
        <div className="flex items-center gap-2">
          <p className="text-sm text-ink-secondary">この30日</p>
          <SelectField
            aria-label="並び順"
            value={sortOrder}
            onChange={(event) => { setSortOrder(event.target.value as 'runs' | 'priority' | 'name'); setPage(1) }}
            options={[
              { value: 'runs', label: '動いた回数が多い順' },
              { value: 'priority', label: '動く順' },
              { value: 'name', label: '名前順' },
            ]}
            className="h-10 min-w-36"
          />
        </div>
      </div>

      {tab !== 'stopped' ? (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="状態で絞り込む">
          {([
            ['all', `すべて ${automations.length}`],
            ['active', `動いている ${activeCount ?? '—'}`],
            ['stopped', `止めている ${stoppedCount ?? '—'}`],
          ] as const).map(([value, label]) => (
            <FilterChip
              key={value}
              selected={statusFilter === value}
              onChange={() => { setStatusFilter(value); setPage(1) }}
            >
              {label}
            </FilterChip>
          ))}
          <span className="flex h-9 items-center rounded-full border border-hairline bg-canvas-sunken px-4 text-sm text-ink-faint">失敗あり {automations.filter((item) => item.failureCount30d > 0).length}</span>
          <span className="flex h-9 items-center rounded-full border border-hairline bg-canvas-sunken px-4 text-sm text-ink-faint">30日 動いていない {automations.filter((item) => item.executionCount30d === 0).length}</span>
        </div>
      ) : null}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {loadStatus === 'loading' ? (
        <ListState kind="loading" title="オートメーションを読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="オートメーションを表示できませんでした"
          description="登録したルールは消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button variant="secondary" onClick={() => void loadAutomations()}>オートメーションを再読み込み</Button>}
        />
      ) : visibleAutomations.length === 0 ? (
        <ListState
          kind="empty"
          title={automations.length === 0
            ? (tab === 'stopped' ? '止めているオートメーションはありません。' : '動いているオートメーションはありません。')
            : '条件に合うオートメーションはありません。'}
          description={automations.length === 0 ? 'きっかけ・だれに・することの3つを決めると動きます。' : '検索語や絞り込みを変えてください。'}
          action={tab === 'active' && canManageAutomations ? <Button href="/automations/new" variant="primary">ルールを作成</Button> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
          <div className="grid grid-cols-6 gap-3 bg-canvas-sunken px-4 py-3 text-xs font-semibold text-ink-faint">
            <span>きっかけ</span><span>だれに（条件）</span><span>すること</span><span>この30日</span><span>状態</span><span aria-hidden />
          </div>
          {pagedAutomations.map((automation) => (
            <div key={automation.id} className="grid min-h-14 grid-cols-6 items-center gap-3 border-t border-hairline px-4 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink" title={automation.name}>{automation.name}</p>
                <p className="truncate text-xs text-ink-faint" title={automationTriggerLabel(automation.eventType)}>{automationTriggerLabel(automation.eventType)}</p>
              </div>
              <p className="truncate text-ink-secondary" title={conditionLabel(automation.conditions)}>{conditionLabel(automation.conditions)}</p>
              <p className="truncate text-ink-secondary" title={automation.actions.map((action) => automationActionLabel(action.type)).join('、')}>{automation.actions.map((action) => automationActionLabel(action.type)).join('、') || '処理なし'}</p>
              <div>
                <span className="text-ink tabular-nums">{automation.executionCount30d.toLocaleString('ja-JP')}回</span>
                {automation.failureCount30d > 0 ? <span className="text-danger block text-[11px]">失敗が{automation.failureCount30d}回</span> : null}
              </div>
              {/* #670 25: 状態は他画面と同じ札(Chip)で出す。素テキストだと列の中で浮く。 */}
              <span><Chip tone={automation.isActive ? 'ok' : 'neutral'}>{automation.isActive ? '動いています' : '止めています'}</Chip></span>
              {/* 見るだけの導線は閲覧のみにも出す。検索語にこの行の名前を載せて実対象を引き継ぐ（#677で承認されたN-352の導線部分）。 */}
              <AutomationRowActions
                automation={automation}
                canManage={canManageAutomations}
                busy={rowBusyId !== null}
                onToggle={() => handleToggleActive(automation)}
                onEdit={() => void handleEdit(automation)}
                onDuplicate={() => void handleDuplicate(automation)}
                onArchive={() => handleArchive(automation)}
                onViewRuns={() => router.push(`/automations/runs?search=${encodeURIComponent(automation.name)}`)}
              />
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-ink-faint">
            <span>オートメーション {visibleAutomations.length}本中 {(currentPage - 1) * AUTOMATION_PAGE_SIZE + 1}〜{Math.min(currentPage * AUTOMATION_PAGE_SIZE, visibleAutomations.length)}本を表示</span>
            {/* #670 9: 送る先が1ページだけならページ送りは出さない。押せない口が並ぶと「まだ何かある」と読める。 */}
            {listPageCount > 1 ? (
              <div className="flex items-center gap-3" aria-label="ページ送り">
                <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="text-action disabled:text-ink-faint">前へ</button>
                {Array.from({ length: listPageCount }, (_, index) => index + 1).map((pageNumber) => (
                  <button key={pageNumber} type="button" aria-current={pageNumber === currentPage ? 'page' : undefined} onClick={() => setPage(pageNumber)} className={pageNumber === currentPage ? 'text-action font-bold' : ''}>{pageNumber}</button>
                ))}
                <button type="button" disabled={currentPage >= listPageCount} onClick={() => setPage(currentPage + 1)} className="text-action disabled:text-ink-faint">次へ</button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending === null
            ? ''
            : pending.kind === 'archive'
              ? `「${pending.automation.name}」を保管しますか？`
              : pending.automation.isActive
                ? `「${pending.automation.name}」を止めますか？`
                : `「${pending.automation.name}」を動かしますか？`
        }
        description={
          pending === null
            ? ''
            : pending.kind === 'archive'
              ? '一覧から隠します。動いた記録と設定は残りますが、この画面からは元に戻せません。必要なら複製して作り直してください。'
              : pending.automation.isActive
                ? '止めているあいだ、このきっかけでは何も動きません。ルールの設定は残るので、あとから動かし直せます。'
                : 'これから起きるきっかけで動き始めます。止めているあいだに起きたぶんは、さかのぼって動きません。あとから止められます。'
        }
        confirmLabel={
          pending === null
            ? '実行する'
            : pending.kind === 'archive'
              ? '保管する'
              : pending.automation.isActive
                ? '止める'
                : '動かす'
        }
        /* 取り消せるのは稼働の切り替えだけ。赤は本当に戻せない保管に取っておく。
           戻せる操作にも赤を付けると、赤が「危ない」を意味しなくなる。 */
        destructive={pending?.kind === 'archive'}
        busy={working}
        error={actionError}
        /* アカウントが変わっているあいだは実行のボタンそのものを出さない
           （`ConfirmDialog` は `onConfirm` が `undefined` だとボタンを出さない）。 */
        onConfirm={accountChanged ? undefined : () => void runPending()}
        onCancel={() => {
          if (working) return
          setPending(null)
          setActionError('')
        }}
      >
        {pending !== null && (
          <div className="text-ink-secondary space-y-2 text-sm">
            <p>
              きっかけ：{automationTriggerLabel(pending.automation.eventType)} ／ アクション{' '}
              {pending.automation.actions.length}件
            </p>
            {pending.automation.lineAccountId === null && (
              <p className="text-warning font-medium">
                全アカウント共通のルールです。
                {pending.kind === 'archive'
                  ? 'すべてのアカウントの一覧から隠れます。'
                  : 'すべてのアカウントに効きます。'}
              </p>
            )}
            {/* 実行の記録を持っていない。「0回」と書くと、動いていないのか
                数えていないのか区別が付かなくなる。 */}
            <p className="text-ink-faint text-xs">
              このルールが何回動いたかは記録していないため、ここには出せません。
            </p>
            {accountChanged && (
              <p className="text-warning font-medium">
                押したあとにLINEアカウントが切り替わりました。この窓を閉じて、いまのアカウントの一覧から選び直してください。
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
