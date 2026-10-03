'use client'

/*
 * ★V8-B ルールの一覧（板 `LWQXd`・状態 `S3pdQ`・1152 `En14p`）。
 *
 * v7（page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （一覧・状態の切り替え・編集用の下書き・複製・保管・確認窓）。
 * 変える操作は器の外（共通の部品・API）へ触らない。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Chip from '@/components/shared/chip'
import SegmentedControl from '@/components/shared/segmented'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import MetricValue from '@/components/ui/metric-value'
import { TextField } from '@/components/shared/text-field'
import {
  automationActionLabel,
  automationTriggerLabel,
  type Automation as SharedAutomation,
} from '@line-crm/shared'
import { formatNumber } from '@/lib/format'
import {
  V8AutoCreateButton,
  type AutoV8Counts,
  type AutoV8Model,
} from './automations-v8'
import AutomationTemplateGallery from '@/components/automations/automation-template-gallery'
import styles from './automations-v8.module.css'

interface Automation extends SharedAutomation {
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

type PendingAction = {
  kind: 'toggle' | 'archive'
  automation: Automation
  accountId: string | null
}

function createActionLock(): { tryAcquire: () => boolean; release: () => void } {
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

/* v7 と同じ口・同じ失敗の分け方（AUTOMATION-05）。 */
function describeEditFailure(caught: unknown): string {
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

const RULE_PAGE_SIZE = 12

type StatusFilter = 'all' | 'active' | 'stopped'

export function V8RulesTab({
  model,
  onCounts,
}: {
  model: AutoV8Model
  onCounts: (counts: AutoV8Counts) => void
}) {
  const { readonly, canManage } = model
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()

  const [automations, setAutomations] = useState<Automation[]>([])
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [automaticRuns, setAutomaticRuns] = useState<number | null>(null)
  const [failedRuns, setFailedRuns] = useState<number | null>(null)
  const [estimatedHoursSaved, setEstimatedHoursSaved] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState('')
  const [error, setError] = useState('')
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const loadRequestRef = useRef(0)
  const actionLockRef = useRef(createActionLock())
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId

  const loadAutomations = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setLoadError(null)
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
      const templateCount = templatesResponse?.success ? templatesResponse.data.length : null
      const commonActionCount = commonActionsResponse?.success ? commonActionsResponse.data.length : null
      onCounts({
        rules: res.success ? res.data.length : null,
        templates: templateCount,
        commonActions: commonActionCount,
      })
    } catch (caught) {
      if (requestId !== loadRequestRef.current) return
      setAutomations([])
      setLoadError(caught)
      setLoadStatus('error')
      setAutomaticRuns(null)
      setFailedRuns(null)
      setEstimatedHoursSaved(null)
      onCounts({ rules: null, templates: null, commonActions: null })
    }
  }, [selectedAccountId, onCounts])

  useEffect(() => {
    if (accountLoading) return
    void loadAutomations()
    return () => {
      loadRequestRef.current += 1
    }
  }, [accountLoading, loadAutomations])

  const runToggleOrArchive = async () => {
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
        const res = await api.automations.setStatus(
          action.automation.id,
          action.automation.isActive ? 'stopped' : 'active',
        )
        if (!res.success) throw new Error(res.error)
      }
      if (selectedAccountIdRef.current === action.accountId) await loadAutomations()
      setPending(null)
    } catch {
      if (selectedAccountIdRef.current === action.accountId) await loadAutomations()
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
        setError(describeEditFailure(caught))
        if (caught instanceof ApiError && (caught.status === 404 || caught.status === 409)) {
          void loadAutomations()
        }
      }
    } finally {
      setRowBusyId(null)
    }
  }

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

  const activeCount = loadStatus === 'ready' ? automations.filter((item) => item.isActive).length : null
  const stoppedCount = loadStatus === 'ready' ? automations.filter((item) => !item.isActive).length : null

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja')
  const visibleAutomations = automations
    .filter((item) => {
      if (statusFilter === 'active') return item.isActive
      if (statusFilter === 'stopped') return !item.isActive
      return true
    })
    .filter((item) => {
      if (!normalizedQuery) return true
      const actions = item.actions.map((action) => automationActionLabel(action.type)).join(' ')
      return `${item.name} ${item.description ?? ''} ${automationTriggerLabel(item.eventType)} ${actions}`
        .toLocaleLowerCase('ja')
        .includes(normalizedQuery)
    })
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'ja'))

  const listPageCount = Math.max(1, Math.ceil(visibleAutomations.length / RULE_PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), listPageCount)
  const pagedAutomations = visibleAutomations.slice(
    (currentPage - 1) * RULE_PAGE_SIZE,
    currentPage * RULE_PAGE_SIZE,
  )

  if (loadStatus === 'loading') {
    return <ListState kind="loading" title="ルールを読み込んでいます" />
  }

  if (loadStatus === 'error') {
    return (
      <ListState
        kind="error"
        title="ルールを読み込めませんでした"
        description="通信状態を確認して、もう一度読み込んでください。"
        onRetry={() => void loadAutomations()}
      />
    )
  }

  return (
    <div>
      {error ? <p role="alert" className={styles.errorBand}>{error}</p> : null}

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>動いているもの</p>
          <p className={styles.kpiValue}><MetricValue value={activeCount} unit="本" /></p>
          <p className={styles.kpiSub}>止めているもの {stoppedCount ?? '—'}本</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>今月の実行（この30日）</p>
          <p className={styles.kpiValue}><MetricValue value={automaticRuns ?? null} unit="回" /></p>
          <p className={styles.kpiSub}>分析の「使われ方」と同じ集計</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>失敗した</p>
          <p className={styles.kpiValue}><MetricValue value={failedRuns ?? null} unit="回" /></p>
          <p className={styles.kpiSub}>部分成功を含む・この30日</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>減らせた手作業</p>
          <p className={styles.kpiValue}><MetricValue value={estimatedHoursSaved} prefix="およそ" unit="時間" /></p>
          <p className={styles.kpiSub}>1回30秒として計算しています</p>
        </div>
      </div>

      <p className={styles.footnote}>上から順に見て、当てはまったものが動きます。同じきっかけで2本が当てはまると両方が動くため、片方だけにしたいときは条件をずらしてください。</p>

      <div className={styles.toolbar}>
        <V8AutoCreateButton href="/automations/new" readonly={readonly}>＋ ルールを作る</V8AutoCreateButton>
        {readonly ? null : <Button href="/automations?tab=templates">見本から作る</Button>}
      </div>

      <div className={styles.toolbar}>
        <TextField
          aria-label="ルール名・きっかけ・することで検索"
          placeholder="ルール名・きっかけ・することで検索"
          value={searchQuery}
          onChange={(event) => { setSearchQuery(event.target.value); setPage(1) }}
          className={styles.toolsSearch}
        />
        <SegmentedControl
          aria-label="状態で絞り込む"
          value={statusFilter}
          onChange={(value) => { setStatusFilter(value); setPage(1) }}
          options={[
            { value: 'all', label: `すべて ${automations.length}` },
            { value: 'active', label: `動いている ${activeCount ?? '—'}` },
            { value: 'stopped', label: `止めている ${stoppedCount ?? '—'}` },
          ]}
        />
      </div>

      {pagedAutomations.length === 0 ? (
        <ListState
          kind="empty"
          title={automations.length === 0 ? 'まだルールがありません' : '当てはまるルールがありません'}
          description={automations.length === 0 ? '「＋ ルールを作る」か見本から、最初の1本を作ってください。' : '探す言葉や状態の絞り込みを変えてください。'}
        />
      ) : (
        <ul className={styles.ruleGrid}>
          {pagedAutomations.map((automation) => (
            <V8RuleCard
              key={automation.id}
              automation={automation}
              canManage={canManage}
              busy={rowBusyId === automation.id}
              onEdit={() => void handleEdit(automation)}
              onDuplicate={() => void handleDuplicate(automation)}
              onViewRuns={() => router.push(`/automations/runs?search=${encodeURIComponent(automation.name)}`)}
              onToggle={() => {
                setActionError('')
                setPending({ kind: 'toggle', automation, accountId: selectedAccountId })
              }}
              onArchive={() => {
                setActionError('')
                setPending({ kind: 'archive', automation, accountId: selectedAccountId })
              }}
            />
          ))}
        </ul>
      )}

      {visibleAutomations.length > RULE_PAGE_SIZE ? (
        <div className={styles.footer}>
          <ListRange
            total={visibleAutomations.length}
            first={(currentPage - 1) * RULE_PAGE_SIZE + 1}
            last={Math.min(currentPage * RULE_PAGE_SIZE, visibleAutomations.length)}
          />
          <Pagination
            page={currentPage}
            pageCount={listPageCount}
            onPageChange={setPage}
          />
        </div>
      ) : null}

      {pending ? (
        <ConfirmDialog
          open
          title={pending.kind === 'archive' ? 'このルールを保管する' : pending.automation.isActive ? 'このルールを止める' : 'このルールを動かす'}
          description={
            pending.kind === 'archive'
              ? `「${pending.automation.name}」を一覧から隠します。実行記録は残ります。元に戻せません。`
              : pending.automation.isActive
                ? `「${pending.automation.name}」を止めます。止めている間は動きません。`
                : `「${pending.automation.name}」を動かします。きっかけが当てはまると実行されます。`
          }
          confirmLabel={pending.kind === 'archive' ? '保管する' : pending.automation.isActive ? '止める' : '動かす'}
          cancelLabel="キャンセル"
          busy={working}
          error={actionError || undefined}
          onCancel={() => { if (!working) setPending(null) }}
          onConfirm={() => void runToggleOrArchive()}
        />
      ) : null}
    </div>
  )
}

/*
 * 見本（板 `c7dxp`）：選ぶとそのまま「つくる」が開く。中身は自由に直せる。
 * 画廊の器は v7 と同じ部品を使う。
 */
export function V8TemplatesTab({ canManage }: { canManage: boolean | null }) {
  const { selectedAccountId } = useAccount()
  return (
    <div>
      <p className={styles.footnote}>見本を選ぶと、そのまま「つくる」画面が開きます。中身は自由に直せます。よく使われている順に並べています。</p>
      <AutomationTemplateGallery accountId={selectedAccountId} canManage={canManage} />
    </div>
  )
}

function V8RuleCard({
  automation,
  canManage,
  busy,
  onEdit,
  onDuplicate,
  onToggle,
  onArchive,
  onViewRuns,
}: {
  automation: Automation
  canManage: boolean | null
  busy: boolean
  onEdit: () => void
  onDuplicate: () => void
  onToggle: () => void
  onArchive: () => void
  onViewRuns: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const runsHref = `/automations/runs?search=${encodeURIComponent(automation.name)}`
  const trigger = automationTriggerLabel(automation.eventType)
  const actionNames = automation.actions.map((action) => automationActionLabel(action.type)).join('・')

  return (
    <li className={styles.ruleCard}>
      <div className={styles.ruleHead}>
        <p className={styles.ruleTitle}>{automation.name}</p>
        <Chip tone={automation.isActive ? 'ok' : 'neutral'}>{automation.isActive ? '動いている' : '止めている'}</Chip>
      </div>
      <p className={styles.ruleFlow}>{trigger} → {actionNames || 'すること未設定'}</p>
      <p className={styles.ruleMeta}>
        この30日 {formatNumber(automation.executionCount30d)}回動いた
        {automation.lastRunAt ? `・さいご ${automation.lastRunAt.slice(0, 10)}` : ''}
      </p>
      <div className={styles.ruleActions}>
        {canManage ? (
          <>
            <Button onClick={onEdit} disabled={busy} variant="secondary" size="compact">編集する</Button>
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
                { id: 'runs', label: '動いた記録を見る', disabled: busy, external: true, onSelect: onViewRuns },
                { id: 'duplicate', label: '複製する', disabled: busy, onSelect: onDuplicate },
                {
                  id: 'toggle',
                  label: automation.isActive ? '止める' : '動かす',
                  disabled: busy,
                  onSelect: onToggle,
                },
                { id: 'archive', label: '保管する', disabled: busy, onSelect: onArchive },
              ]}
            />
          </>
        ) : (
          <Button href={runsHref} variant="secondary" size="compact">動いた記録を見る</Button>
        )}
      </div>
    </li>
  )
}
