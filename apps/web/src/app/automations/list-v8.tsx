'use client'

/*
 * ★V8-B オートメーションの一覧（板 `LWQXd`）と見本タブ（板 `c7dxp`）。
 * 状態の板は `S3pdQ`、1152px は `En14p`、閲覧のみは `nH9L8`。
 *
 * フォルダの列は機能追加 F-13（フォルダ API）待ちのため置かない。
 * 「＋ ルールを作る」は道具の段の左（En14p の畳んだ形）で常に出す。
 *
 * v7（`page.tsx`）と同じ口・同じ動き：稼働切替・保管は確認窓を経由し、
 * 編集・複製は下書きを作ってから編集面へ進む。ここでは見え方だけを V8 に積み替える。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  Filter,
  ListChecks,
  MoreHorizontal,
  Play,
  Zap,
} from 'lucide-react'
import { api, ApiError, fetchApi, type AutomationListItem, type AutomationTemplateSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import { Tabs } from '@/components/shared/tabs'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useManualHref } from '@/lib/use-manual-href'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { automationActionLabel, automationTriggerLabel } from '@line-crm/shared'
import { formatNumber } from '@/lib/format'
import styles from './list-v8.module.css'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

type LoadStatus = 'loading' | 'ready' | 'error'

type PendingAction = {
  kind: 'toggle' | 'archive'
  automation: AutomationListItem
  accountId: string | null
}

type AutomationActionLock = {
  tryAcquire: () => boolean
  release: () => void
}

/** v7（page.tsx）と同じ、画面内だけの単一実行ロック。 */
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

/** v7（page.tsx）の `describeAutomationEditFailure` と同じ言い分け。 */
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

function conditionLabel(conditions: Record<string, unknown>): string {
  const keyword = typeof conditions.keyword === 'string' ? conditions.keyword.trim() : ''
  if (keyword) return `「${keyword}」を含む人`
  if (Object.keys(conditions).length === 0) return '条件なし'
  return '登録した条件'
}

/** 動いた記録の集計（`LWQXd` の「条件に外れた」「いちばん動いた」に使う）。 */
type RunsSummary = {
  total: number
  executed: number
  skipped: number
  failed: number
  mostRunName: string | null
  mostRunCount: number | null
}

const SORT_OPTIONS = [
  { value: 'runs', label: '動いた回数が多い順' },
  { value: 'priority', label: '動く順' },
  { value: 'name', label: '名前順' },
] as const

type SortKey = (typeof SORT_OPTIONS)[number]['value']

const SAVED_FILTER_OPTIONS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'ran', label: 'この30日に動いた' },
  { value: 'failed', label: '失敗がある' },
  { value: 'idle', label: 'この30日に動いていない' },
] as const

type SavedFilter = '' | 'ran' | 'failed' | 'idle'

const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
  { value: '100', label: '100件表示' },
]

/*
 * 見本の「きっかけ」札（c7dxp）。見本の型にはきっかけの種類IDが無いため、
 * 一覧の文言（triggerLabel）から当てはまる札へ振り分ける。
 * メッセージ系を先に見る（「メッセージに『予約』が入ったとき」は予約ではなくメッセージ）。
 */
const TEMPLATE_CHIPS: Array<{ key: string; label: string; match: (label: string) => boolean }> = [
  { key: 'friend', label: '友だちになった', match: (label) => /友だち/.test(label) },
  { key: 'message', label: 'メッセージを受け取った', match: (label) => /メッセージ|届いた|送られた|ポストバック/.test(label) },
  { key: 'tag', label: 'タグが付いた', match: (label) => /タグ/.test(label) },
  { key: 'form', label: 'フォームに答えた', match: (label) => /フォーム|回答/.test(label) },
  { key: 'booking', label: '予約が確定した', match: (label) => /予約/.test(label) },
  { key: 'order', label: '注文が確定した', match: (label) => /注文|定期便|発送|購入|買っ/.test(label) },
]

function templateChipKey(template: AutomationTemplateSummary): string {
  const label = `${template.triggerLabel} ${template.name}`
  const found = TEMPLATE_CHIPS.find((chip) => chip.match(label))
  return found?.key ?? ''
}

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

export default function AutomationsListV8() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useCanManageAutomations()
  const manualHref = useManualHref('/automations')
  const tabParam = searchParams.get('tab')
  const showTemplates = tabParam === 'templates'
  usePageTitle(showTemplates ? '見本から作る' : 'オートメーション')

  const [items, setItems] = useState<AutomationListItem[]>([])
  const [summary, setSummary] = useState<{ active: number; stopped: number; executionCount30d: number; failureCount30d: number } | null>(null)
  const [runsSummary, setRunsSummary] = useState<RunsSummary | null>(null)
  const [templates, setTemplates] = useState<AutomationTemplateSummary[] | null>(null)
  const [templatesStatus, setTemplatesStatus] = useState<LoadStatus>('loading')
  const [commonActionCount, setCommonActionCount] = useState<number | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [statusChip, setStatusChip] = useState<'' | 'active' | 'stopped'>(tabParam === 'stopped' ? 'stopped' : '')
  const [sortKey, setSortKey] = useState<SortKey>('runs')
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState('')
  const [templateBusyKey, setTemplateBusyKey] = useState<string | null>(null)
  const [templateChip, setTemplateChip] = useState('')

  const accountChanged = pending !== null && pending.accountId !== selectedAccountId
  const loadRequestRef = useRef(0)
  const actionLockRef = useRef(createAutomationActionLock())
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId

  const loadTemplates = useCallback(async () => {
    if (!selectedAccountId) {
      setTemplates(null)
      setTemplatesStatus('ready')
      return
    }
    setTemplatesStatus('loading')
    try {
      const res = await api.automations.templates(selectedAccountId)
      if (res.success) {
        setTemplates(res.data)
        setTemplatesStatus('ready')
      } else {
        setTemplatesStatus('error')
      }
    } catch {
      setTemplatesStatus('error')
    }
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setLoadError(null)
    setError('')
    try {
      const [res, commonActionsResponse, runsResponse] = await Promise.all([
        api.automations.list({ accountId: selectedAccountId || undefined }),
        selectedAccountId
          ? api.commonActions.list({ accountId: selectedAccountId }).catch(() => null)
          : Promise.resolve(null),
        /*
         * 「条件に外れた」は実行記録の集計口だけが返す。行は要らないので
         * 1件だけ取る（期間は口の既定＝この30日）。
         */
        fetchApi<ApiResponse<{ summary: RunsSummary }>>(
          `/api/automation-runs?limit=1&offset=0${selectedAccountId ? `&lineAccountId=${encodeURIComponent(selectedAccountId)}` : ''}`,
        ).catch(() => null),
      ])
      if (requestId !== loadRequestRef.current) return
      if (res.success) {
        setItems(res.data)
        setSummary(res.summary ?? null)
        setLoadStatus('ready')
      } else {
        setItems([])
        setSummary(null)
        setLoadStatus('error')
      }
      setCommonActionCount(
        commonActionsResponse?.success ? commonActionsResponse.data.length : null,
      )
      setRunsSummary(runsResponse?.success && runsResponse.data?.summary ? runsResponse.data.summary : null)
    } catch (caught) {
      if (requestId !== loadRequestRef.current) return
      setItems([])
      setSummary(null)
      setLoadError(caught)
      setLoadStatus('error')
      setCommonActionCount(null)
      setRunsSummary(null)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
    void loadTemplates()
    return () => {
      loadRequestRef.current += 1
    }
  }, [accountLoading, load, loadTemplates])

  /** v7 と同じ：稼働の入れ替えは必ず確認窓を経由する。 */
  const applyToggle = async (target: AutomationListItem) => {
    const res = await api.automations.setStatus(target.id, target.isActive ? 'stopped' : 'active')
    if (!res.success) throw new Error(res.error)
  }

  const handleToggle = (target: AutomationListItem) => {
    setActionError('')
    setPending({ kind: 'toggle', automation: target, accountId: selectedAccountId })
  }

  const handleArchive = (target: AutomationListItem) => {
    setActionError('')
    setPending({ kind: 'archive', automation: target, accountId: selectedAccountId })
  }

  const handleEdit = async (target: AutomationListItem) => {
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
          void load()
        }
      }
    } finally {
      setRowBusyId(null)
    }
  }

  const handleDuplicate = async (target: AutomationListItem) => {
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

  /** 見本から下書きを作り、作れたら編集面へ進む（v7 画廊と同じ動き）。 */
  const handleTemplate = async (templateKey: string) => {
    if (!selectedAccountId || templateBusyKey) return
    setActionError('')
    setError('')
    setTemplateBusyKey(templateKey)
    const accountId = selectedAccountId
    try {
      const res = await api.automations.createDraftFromTemplate(
        templateKey,
        accountId,
        crypto.randomUUID(),
      )
      if (!res.success) throw new Error(res.error)
      if (selectedAccountIdRef.current !== accountId) return
      router.push(`/automations/drafts?id=${encodeURIComponent(res.data.id)}`)
    } catch {
      if (selectedAccountIdRef.current === accountId) {
        setError('見本から下書きを作れませんでした。もう一度お試しください。')
      }
    } finally {
      setTemplateBusyKey(null)
    }
  }

  const runPending = async () => {
    if (!pending) return
    const action = pending
    if (action.accountId !== selectedAccountIdRef.current || !actionLockRef.current.tryAcquire()) return
    setWorking(true)
    setActionError('')
    try {
      if (action.kind === 'archive') {
        const res = await api.automations.setStatus(action.automation.id, 'archived')
        if (!res.success) throw new Error(res.error)
      } else {
        await applyToggle(action.automation)
      }
      if (selectedAccountIdRef.current === action.accountId) await load()
      setPending(null)
    } catch {
      if (selectedAccountIdRef.current === action.accountId) await load()
      setActionError(
        action.kind === 'archive'
          ? 'このルールを保管できませんでした。状態を読み直してから、もう一度お試しください。'
          : '稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      actionLockRef.current.release()
      setWorking(false)
    }
  }

  /* ===== 絞り込み・並び（v7 と同じ手元処理。フォルダは F-13 待ちで無し） ===== */

  const normalizedQuery = query.trim().toLocaleLowerCase('ja')
  const visible = items
    .filter((item) => (statusChip === '' ? true : statusChip === 'active' ? item.isActive : !item.isActive))
    .filter((item) => {
      if (savedFilter === 'ran') return item.executionCount30d > 0
      if (savedFilter === 'failed') return item.failureCount30d > 0
      if (savedFilter === 'idle') return item.executionCount30d === 0
      return true
    })
    .filter((item) => {
      if (!normalizedQuery) return true
      const actions = item.actions.map((action) => automationActionLabel(action.type)).join(' ')
      return `${item.name} ${item.description ?? ''} ${automationTriggerLabel(item.eventType)} ${actions}`
        .toLocaleLowerCase('ja')
        .includes(normalizedQuery)
    })
    .sort((a, b) =>
      sortKey === 'name'
        ? a.name.localeCompare(b.name, 'ja')
        : sortKey === 'runs'
          ? b.executionCount30d - a.executionCount30d || a.name.localeCompare(b.name, 'ja')
          : b.priority - a.priority || a.name.localeCompare(b.name, 'ja'),
    )
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const paged = visible.slice((safePage - 1) * pageSize, safePage * pageSize)
  const filterActive = normalizedQuery !== '' || statusChip !== '' || savedFilter !== ''

  /* ===== 数の帯（LWQXd の4つ。「先月比」は口に無いので出さない） ===== */

  const activeCount = summary?.active ?? (loadStatus === 'ready' ? items.filter((i) => i.isActive).length : null)
  const stoppedCount = summary?.stopped ?? (loadStatus === 'ready' ? items.filter((i) => !i.isActive).length : null)
  const idleRuleCount = loadStatus === 'ready' ? items.filter((i) => i.isActive && i.executionCount30d === 0).length : null
  const kpis = [
    {
      key: 'rules',
      icon: ListChecks,
      title: 'ルール',
      value: loadStatus === 'error' ? null : items.length,
      unit: '件',
      detail:
        activeCount === null || stoppedCount === null
          ? '—'
          : `動いている ${activeCount}・止めている ${stoppedCount}`,
    },
    {
      key: 'runs30d',
      icon: Play,
      title: '今月動いた',
      value: loadStatus === 'error' ? null : summary?.executionCount30d ?? null,
      unit: '回',
      detail: runsSummary?.mostRunName ? `いちばん動いた ${runsSummary.mostRunName}` : 'この30日',
    },
    {
      key: 'failed',
      icon: AlertCircle,
      title: '失敗',
      value: loadStatus === 'error' ? null : summary?.failureCount30d ?? null,
      unit: '回',
      detail: '「動いた記録」からやり直せます',
    },
    {
      key: 'skipped',
      icon: Filter,
      title: '条件に外れた',
      value: loadStatus === 'error' ? null : runsSummary?.skipped ?? null,
      unit: '回',
      detail: idleRuleCount === null ? 'この30日' : `まだ動いていないルール ${idleRuleCount}`,
    },
  ]

  /* ===== タブ（ルール・共通アクション・動いた記録・見本） ===== */

  const tabItems = [
    {
      label: 'ルール',
      count: loadStatus === 'ready' ? items.length : undefined,
      current: !showTemplates,
      href: '/automations',
    },
    {
      label: '共通アクション',
      count: commonActionCount ?? undefined,
      href: '/common-actions',
    },
    { label: '動いた記録', href: '/automations/runs' },
    {
      label: '見本',
      count: templatesStatus === 'ready' ? templates?.length : undefined,
      current: showTemplates,
      href: '/automations?tab=templates',
    },
  ]

  /* ===== 行の「…」の中身（v7 と同じ4つ） ===== */

  const rowMenuItems = (automation: AutomationListItem): ActionMenuItem[] => [
    {
      id: 'runs',
      label: '動いた記録を見る',
      disabled: rowBusyId !== null,
      onSelect: () =>
        router.push(`/automations/runs?search=${encodeURIComponent(automation.name)}`),
    },
    {
      id: 'duplicate',
      label: '複製する',
      disabled: rowBusyId !== null,
      onSelect: () => void handleDuplicate(automation),
    },
    ...(automation.status === 'draft'
      ? []
      : [
          {
            id: 'toggle',
            label: automation.isActive ? '止める' : '動かす',
            disabled: rowBusyId !== null,
            onSelect: () => handleToggle(automation),
          },
        ]),
    {
      id: 'archive',
      label: '保管する',
      tone: 'danger' as const,
      dividerBefore: true,
      disabled: rowBusyId !== null,
      onSelect: () => handleArchive(automation),
    },
  ]

  /* ===== 表の中身（S3pdQ の状態ごとの見え方） ===== */

  const rulesBody =
    loadStatus === 'loading' ? (
      <div className={styles.skeletonRows} role="status">
        <span className="sr-only">読み込んでいます</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <div key={n} className={styles.skeletonRow}>
            <span className={styles.skeletonDot} />
            <span className={styles.skeletonBar} />
            <span className={styles.skeletonBar} style={{ maxWidth: 120 }} />
          </div>
        ))}
      </div>
    ) : loadStatus === 'error' ? (
      <div className={styles.stateCard}>
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
          <AlertCircle size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>ルールを読み込めませんでした</p>
        <p className={styles.stateDesc}>
          登録したルールは消えていません。再読み込みしても直らない場合はエラー報告へ。
        </p>
        {isForbiddenOrRateLimited(loadError) ? null : (
          <Button type="button" onClick={() => void load()}>もう一度試す</Button>
        )}
      </div>
    ) : visible.length === 0 ? (
      filterActive ? (
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}>
            <Zap size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>条件に合うルールはありません</p>
          <p className={styles.stateDesc}>
            検索語や「動いている」「止めている」の札を外すと、すべて出ます。
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setQuery('')
              setStatusChip('')
              setSavedFilter('')
              setPage(1)
            }}
          >
            条件を外す
          </Button>
        </div>
      ) : (
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}>
            <Zap size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>まだルールはありません</p>
          <p className={styles.stateDesc}>
            「見本から作る」か「ルールを作る」で、きっかけ・だれに・することの3つを決めると動きます。
          </p>
          <div className={styles.stateActions}>
            {canManage ? (
              <>
                <Button type="button" variant="primary" onClick={() => router.push('/automations/new')}>
                  ＋ ルールを作る
                </Button>
                <Button type="button" variant="secondary" onClick={() => router.push('/automations?tab=templates')}>
                  見本から作る
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" disabled title={READONLY_REASON}>
                ＋ ルールを作る
              </Button>
            )}
          </div>
        </div>
      )
    ) : (
      <>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>ルール</th>
                <th>きっかけ</th>
                <th>だれに（条件）</th>
                <th>すること</th>
                <th>この30日</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((automation) => (
                <tr key={automation.id}>
                  <td>
                    {canManage ? (
                      <button
                        type="button"
                        className={styles.cellTitle}
                        title={automation.name}
                        disabled={rowBusyId !== null}
                        onClick={() => void handleEdit(automation)}
                      >
                        {automation.name}
                      </button>
                    ) : (
                      <span className={`${styles.cellTitle} ${styles.cellTitleStatic}`} title={automation.name}>
                        {automation.name}
                      </span>
                    )}
                  </td>
                  <td>
                    <p className={styles.cellText} title={automationTriggerLabel(automation.eventType)}>
                      {automationTriggerLabel(automation.eventType)}
                    </p>
                  </td>
                  <td>
                    <p className={styles.cellText} title={conditionLabel(automation.conditions)}>
                      {conditionLabel(automation.conditions)}
                    </p>
                  </td>
                  <td>
                    <p className={styles.cellText} title={automation.actions.map((a) => automationActionLabel(a.type)).join('、')}>
                      {automation.actions.map((a) => automationActionLabel(a.type)).join('、') || '処理なし'}
                    </p>
                  </td>
                  <td className={styles.countCell}>
                    <span className={styles.countMain}>{formatNumber(automation.executionCount30d)}回</span>
                    {automation.isActive ? (
                      automation.failureCount30d > 0 ? (
                        <span className={styles.countFail}>失敗が{formatNumber(automation.failureCount30d)}回</span>
                      ) : (
                        <span className={styles.countMuted}>失敗 0回</span>
                      )
                    ) : (
                      <span className={styles.countMuted}>
                        {automation.updatedAt ? `止めた日 ${formatStoppedDate(automation.updatedAt)}` : '止めています'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.statePill} ${automation.isActive ? styles.statePillActive : styles.statePillStopped}`}>
                      <span className={styles.stateDot} aria-hidden="true" />
                      {automation.isActive ? '動いています' : '止めています'}
                    </span>
                  </td>
                  <td className={styles.opsCell}>
                    <span className={styles.opsRow}>
                      {canManage ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="compact"
                          disabled={rowBusyId !== null}
                          onClick={() => void handleEdit(automation)}
                        >
                          編集する
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.menuButton}
                        title={`ルール「${automation.name}」の操作`}
                        aria-label={`ルール「${automation.name}」の操作`}
                        aria-haspopup="menu"
                        disabled={rowBusyId !== null}
                        onClick={() =>
                          setOpenMenuId((current) => (current === automation.id ? null : automation.id))
                        }
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </button>
                      <ActionMenu
                        open={openMenuId === automation.id}
                        onClose={() => setOpenMenuId(null)}
                        ariaLabel={`ルール「${automation.name}」の操作`}
                        items={
                          canManage
                            ? rowMenuItems(automation)
                            : [
                                {
                                  id: 'runs',
                                  label: '動いた記録を見る',
                                  onSelect: () =>
                                    router.push(`/automations/runs?search=${encodeURIComponent(automation.name)}`),
                                },
                              ]
                        }
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.tableNote}>
          行の「…」から 編集・複製・止める／動かす・動いた記録を見る・保管。
        </p>
        <div className={styles.pagerRow}>
          <span className={styles.pagerCount}>
            <ListRange
              label="ルール"
              total={visible.length}
              first={(safePage - 1) * pageSize + 1}
              last={Math.min(safePage * pageSize, visible.length)}
            />
          </span>
          <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
        </div>
      </>
    )

  /* ===== 見本タブの中身（c7dxp） ===== */

  const visibleTemplates = (templates ?? []).filter(
    (template) => templateChip === '' || templateChipKey(template) === templateChip,
  )

  const templatesBody = (
    <>
      <div className={styles.templateTools}>
        <span className={styles.templateToolsLabel}>きっかけ</span>
        <FilterChip
          selected={templateChip === ''}
          onChange={() => setTemplateChip('')}
          count={templatesStatus === 'ready' ? templates?.length : undefined}
        >
          すべて
        </FilterChip>
        {TEMPLATE_CHIPS.map((chip) => (
          <FilterChip
            key={chip.key}
            selected={templateChip === chip.key}
            onChange={(on) => setTemplateChip(on ? chip.key : '')}
          >
            {chip.label}
          </FilterChip>
        ))}
        <span className={styles.toolbarSpacer} />
        <Button type="button" variant="secondary" onClick={() => void loadTemplates()}>
          見本を再読み込み
        </Button>
      </div>
      {templatesStatus === 'loading' ? (
        <div className={styles.skeletonRows} role="status">
          <span className="sr-only">見本を読み込んでいます</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.skeletonRow}>
              <span className={styles.skeletonDot} />
              <span className={styles.skeletonBar} />
              <span className={styles.skeletonBar} style={{ maxWidth: 120 }} />
            </div>
          ))}
        </div>
      ) : templatesStatus === 'error' ? (
        <div className={styles.stateCard}>
          <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
            <AlertCircle size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>見本を読み込めませんでした</p>
          <p className={styles.stateDesc}>時間をおいて、もう一度試してください。</p>
          <Button type="button" onClick={() => void loadTemplates()}>もう一度試す</Button>
        </div>
      ) : visibleTemplates.length === 0 ? (
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}>
            <Zap size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>
            {templateChip === '' ? '見本はまだありません' : 'このきっかけの見本はありません'}
          </p>
          <p className={styles.stateDesc}>
            {templateChip === '' ? '' : 'ほかのきっかけを選ぶか、「すべて」に戻してください。'}
          </p>
          {templateChip !== '' ? (
            <Button type="button" variant="secondary" onClick={() => setTemplateChip('')}>
              すべてに戻す
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className={styles.templateGrid}>
            {visibleTemplates.map((template) => (
              <div key={template.key} className={styles.templateCard}>
                <p className={styles.templateName}>{template.name}</p>
                <p className={styles.templateLine}>
                  <span className={styles.templateLineLabel}>きっかけ</span>
                  <span className={styles.templateLineValue}>{template.triggerLabel}</span>
                </p>
                <p className={styles.templateLine}>
                  <span className={styles.templateLineLabel}>すること</span>
                  <span className={styles.templateLineValue}>{template.actionLabel}</span>
                </p>
                <div className={styles.templateCardButton}>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={templateBusyKey !== null || !selectedAccountId}
                      onClick={() => void handleTemplate(template.key)}
                    >
                      {templateBusyKey === template.key ? '作っています…' : 'この見本で下書きを作る'}
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" disabled title={READONLY_REASON}>
                      この見本で下書きを作る
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className={styles.tableNote}>
            実行まで確認できた見本だけを、ここへ表示します。見本に実データは入っていません。見本から作る下書きは、選んだアカウントだけに保存します。
          </p>
        </>
      )}
    </>
  )

  return (
    <div className={styles.board} data-design-node={showTemplates ? 'c7dxp' : 'LWQXd'}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>オートメーション</h2>
          <p className={styles.headDescription}>
            「○○したら △△する」を決めておくと、友だちの動きに合わせて自動で動きます。
          </p>
        </div>
        <div className={styles.headActions}>
          {manualHref ? <Button href={manualHref} variant="secondary">マニュアル</Button> : null}
          {canManage || canManage === null ? (
            <Button href="/automations?tab=templates" variant="secondary">見本から作る</Button>
          ) : (
            <Button type="button" variant="secondary" disabled title={READONLY_REASON}>
              見本から作る
            </Button>
          )}
        </div>
      </div>

      <div data-design="SectionTabs">
        <Tabs label="オートメーションの区画" items={tabItems} />
      </div>

      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.key} className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <kpi.icon size={13} aria-hidden="true" />
              {kpi.title}
            </span>
            <p className={styles.kpiValue}>
              {kpi.value === null ? '—' : formatNumber(kpi.value)}
              <span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span>
            </p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      {canManage === false ? (
        <Notice
          tone="info"
          message="閲覧のみの権限では、作成・変更はできません。中身の確認と、動いた記録の確認ができます。"
        />
      ) : !showTemplates ? (
        <Notice
          tone="info"
          message="ルールは1人で試してから動かすと、まちがいが防げます。動いた結果は「動いた記録」で見られます。"
        />
      ) : null}

      {error ? (
        <p className={styles.errorBand} role="alert">
          {error}
          <button type="button" onClick={() => void load()}>読み直す</button>
        </p>
      ) : null}

      {showTemplates ? (
        templatesBody
      ) : (
        <>
          <div className={styles.toolbar}>
            {canManage ? (
              <Button type="button" variant="primary" onClick={() => router.push('/automations/new')}>
                ＋ ルールを作る
              </Button>
            ) : (
              <Button type="button" variant="primary" disabled title={READONLY_REASON}>
                ＋ ルールを作る
              </Button>
            )}
            <div className={styles.searchWrap}>
              <SearchField
                aria-label="ルール名・きっかけで探す"
                placeholder="ルール名・きっかけで探す"
                value={query}
                onChange={(value) => {
                  setQuery(value)
                  setPage(1)
                }}
                onClear={() => setQuery('')}
              />
            </div>
            <FilterChip
              selected={statusChip === 'active'}
              onChange={(on) => {
                setStatusChip(on ? 'active' : '')
                setPage(1)
              }}
              count={activeCount ?? undefined}
              title="動いているルールだけを出す"
            >
              動いている
            </FilterChip>
            <FilterChip
              selected={statusChip === 'stopped'}
              onChange={(on) => {
                setStatusChip(on ? 'stopped' : '')
                setPage(1)
              }}
              count={stoppedCount ?? undefined}
              title="止めているルールだけを出す"
            >
              止めている
            </FilterChip>
            <span className={styles.toolbarSpacer} />
            <span className={styles.toolbarLabel}>並び</span>
            <Select
              aria-label="並び順"
              value={sortKey}
              onChange={(value) => setSortKey(value as SortKey)}
              options={[...SORT_OPTIONS]}
            />
            <Select
              aria-label="よく使う絞り込み"
              value={savedFilter}
              onChange={(value) => {
                setSavedFilter(value as SavedFilter)
                setPage(1)
              }}
              options={[...SAVED_FILTER_OPTIONS]}
            />
            <Select
              aria-label="1ページに出す件数"
              size="page-size"
              value={String(pageSize)}
              onChange={(value) => {
                setPageSize(Number(value))
                setPage(1)
              }}
              options={PAGE_SIZE_OPTIONS}
            />
          </div>
          {rulesBody}
        </>
      )}

      {/* 稼働切替・保管の確かめ（v7 と同じ文・同じ動き）。 */}
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
        destructive={pending?.kind === 'archive'}
        busy={working}
        error={actionError}
        onConfirm={accountChanged ? undefined : () => void runPending()}
        onCancel={() => {
          if (working) return
          setPending(null)
          setActionError('')
        }}
      >
        {pending !== null ? (
          <div className="text-ink-secondary space-y-2 text-sm">
            <p>
              きっかけ：{automationTriggerLabel(pending.automation.eventType)} ／ アクション{' '}
              {pending.automation.actions.length}件
            </p>
            {pending.automation.lineAccountId === null ? (
              <p className="text-warning font-medium">
                全アカウント共通のルールです。
                {pending.kind === 'archive'
                  ? 'すべてのアカウントの一覧から隠れます。'
                  : 'すべてのアカウントに効きます。'}
              </p>
            ) : null}
            <p className="text-ink-faint text-xs">
              このルールが何回動いたかは記録していないため、ここには出せません。
            </p>
            {accountChanged ? (
              <p className="text-warning font-medium">
                押したあとにLINEアカウントが切り替わりました。この窓を閉じて、いまのアカウントの一覧から選び直してください。
              </p>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

/** 止めた日の見せ方（板の「止めた日 9/1」）。 */
function formatStoppedDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}
