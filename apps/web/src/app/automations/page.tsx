'use client'

import SelectField from '@/components/shared/select-field'
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import AutomationTemplateGallery from '@/components/automations/automation-template-gallery'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import ListState from '@/components/shared/list-state'
import { usePageTitle } from '@/components/shell/page-chrome'
import FilterChip from '@/components/shared/filter-chip'

type LoadStatus = 'loading' | 'ready' | 'error'

type AutomationEventType = "friend_add" | "tag_change" | "score_threshold" | "cv_fire" | "message_received" | "postback_received" | "calendar_booked" | "ec.order.confirmed" | "ec.order.shipped" | "ec.subscription.upcoming" | "ec.subscription.payment_failed" | "ec.subscription.cancelled"

interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu"
  params: Record<string, unknown>
}

interface Automation {
  id: string
  name: string
  description: string | null
  eventType: AutomationEventType
  conditions: Record<string, unknown>
  actions: AutomationAction[]
  isActive: boolean
  priority: number
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

const eventTypeOptions: { value: AutomationEventType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加' },
  { value: 'tag_change', label: 'タグ変更' },
  { value: 'score_threshold', label: 'スコア閾値' },
  { value: 'cv_fire', label: 'CV発火' },
  { value: 'message_received', label: 'メッセージ受信' },
  { value: 'postback_received', label: 'ポストバック受信（リッチメニュー等）' },
  { value: 'calendar_booked', label: 'カレンダー予約' },
  { value: 'ec.order.confirmed', label: 'EC：注文確定' },
  { value: 'ec.order.shipped', label: 'EC：発送完了' },
  { value: 'ec.subscription.upcoming', label: 'EC：定期便の次回予定' },
  { value: 'ec.subscription.payment_failed', label: 'EC：定期便の決済失敗' },
  { value: 'ec.subscription.cancelled', label: 'EC：定期便の解約' },
]

const eventTypeLabelMap: Record<AutomationEventType, string> = {
  friend_add: '友だち追加',
  tag_change: 'タグ変更',
  score_threshold: 'スコア閾値',
  cv_fire: 'CV発火',
  message_received: 'メッセージ受信',
  postback_received: 'ポストバック受信',
  calendar_booked: 'カレンダー予約',
  'ec.order.confirmed': 'EC注文確定',
  'ec.order.shipped': 'EC発送完了',
  'ec.subscription.upcoming': '定期便予定',
  'ec.subscription.payment_failed': '定期便決済失敗',
  'ec.subscription.cancelled': '定期便解約',
}

const eventTypeBadgeColor: Record<AutomationEventType, string> = {
  friend_add: 'bg-success-bg text-green-700',
  tag_change: 'bg-blue-100 text-blue-700',
  score_threshold: 'bg-warning-bg text-yellow-700',
  cv_fire: 'bg-red-100 text-danger',
  message_received: 'bg-purple-100 text-purple-700',
  postback_received: 'bg-pink-100 text-pink-700',
  calendar_booked: 'bg-indigo-100 text-indigo-700',
  'ec.order.confirmed': 'bg-emerald-100 text-emerald-700',
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
  kind: 'toggle' | 'delete'
  automation: Automation
  accountId: string | null
}

interface CreateFormState {
  name: string
  description: string
  eventType: AutomationEventType
  actionsJson: string
  conditionsJson: string
  priority: number
}

const initialForm: CreateFormState = {
  name: '',
  description: '',
  eventType: 'friend_add',
  actionsJson: '[\n  {\n    "type": "add_tag",\n    "params": {}\n  }\n]',
  conditionsJson: '{}',
  priority: 0,
}

function actionLabel(action: AutomationAction): string {
  const labels: Record<AutomationAction['type'], string> = {
    add_tag: 'タグを付ける',
    remove_tag: 'タグを外す',
    start_scenario: 'シナリオを始める',
    send_message: 'メッセージを送る',
    send_webhook: '外部連携に知らせる',
    switch_rich_menu: 'リッチメニューを切り替える',
  }
  return labels[action.type]
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

export default function AutomationsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const tab = useMergedTab(MERGED_TABS)
  usePageTitle(tab === 'templates' ? '見本から作る' : 'オートメーション')
  const canManageAutomations = useCanManageAutomations()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ ...initialForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
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
  const [actionError, setActionError] = useState('')
  const [automaticRuns, setAutomaticRuns] = useState<number | null>(null)
  const [failedRuns, setFailedRuns] = useState<number | null>(null)
  const [estimatedHoursSaved, setEstimatedHoursSaved] = useState<number | null>(null)
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [commonActionCount, setCommonActionCount] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'stopped'>('all')
  const [sortOrder, setSortOrder] = useState<'runs' | 'priority' | 'name'>('runs')
  /** 押したあとにアカウントが変わったか。変わっていたら実行させない。 */
  const accountChanged = pending !== null && pending.accountId !== selectedAccountId
  const loadRequestRef = useRef(0)

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

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }

    let parsedActions: AutomationAction[]
    let parsedConditions: Record<string, unknown>
    try {
      parsedActions = JSON.parse(form.actionsJson)
    } catch {
      setFormError('アクションのJSON形式が正しくありません')
      return
    }
    try {
      parsedConditions = JSON.parse(form.conditionsJson)
    } catch {
      setFormError('条件のJSON形式が正しくありません')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const res = await api.automations.create({
        name: form.name,
        description: form.description || null,
        eventType: form.eventType,
        actions: parsedActions,
        conditions: parsedConditions,
        priority: form.priority,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ ...initialForm })
        loadAutomations()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  /** 稼働の入れ替えそのもの。返事を確かめてから呼び出し元に戻す。 */
  const applyToggle = async (target: Automation) => {
    const res = await api.automations.update(target.id, { isActive: !target.isActive })
    if (!res.success) throw new Error(res.error)
  }

  const handleToggleActive = async (target: Automation) => {
    // 全アカウント共通のルールは、1つのアカウントの画面から触っても
    // すべてのアカウントに効く。ここだけ確認を挟む。
    if (target.lineAccountId === null) {
      setActionError('')
      setPending({ kind: 'toggle', automation: target, accountId: selectedAccountId })
      return
    }
    try {
      await applyToggle(target)
      await loadAutomations()
    } catch {
      setError('稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。')
    }
  }

  const handleDelete = (target: Automation) => {
    setActionError('')
    setPending({ kind: 'delete', automation: target, accountId: selectedAccountId })
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
    if (!pending || working || accountChanged) return
    setWorking(true)
    setActionError('')
    try {
      if (pending.kind === 'delete') {
        const res = await api.automations.delete(pending.automation.id)
        if (!res.success) throw new Error(res.error)
      } else {
        await applyToggle(pending.automation)
      }
      setPending(null)
      await loadAutomations()
    } catch {
      setActionError(
        pending.kind === 'delete'
          ? 'このルールを削除できませんでした。状態を読み直してから、もう一度お試しください。'
          : '稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setWorking(false)
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
          <Button href="/automations/new">はじめから作る</Button>
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
        const actions = item.actions.map((action) => actionLabel(action)).join(' ')
        return `${item.name} ${item.description ?? ''} ${eventTypeLabelMap[item.eventType]} ${actions}`
          .toLocaleLowerCase('ja')
          .includes(normalizedQuery)
      })
      .sort((a, b) => sortOrder === 'name'
        ? a.name.localeCompare(b.name, 'ja')
        : sortOrder === 'runs'
          // Pencilの一覧順は、30日実績の表示値ではなく設定した実行順を保つ。
          ? b.priority - a.priority || a.name.localeCompare(b.name, 'ja')
          : b.priority - a.priority || a.name.localeCompare(b.name, 'ja'))
  })()

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
          <Button href="/automations/new" variant="primary">ルールを作成</Button>
          <Button href="/support">マニュアル</Button>
        </div>
      </div>

      <p className="mb-4 text-sm text-ink-faint">「〜のとき、〜する」を登録して自動で実行します。友だち一覧から手で実行したり、毎日決まった時刻に動かすこともできます。</p>
      <p className="sr-only">共通アクションは友だち一覧からの手動実行にも使えます。</p>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">動いているもの</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {activeCount ?? '—'}
            {activeCount !== null ? <span className="text-ink-faint ml-0.5 text-xs font-normal">本</span> : null}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">稼働中 {activeCount ?? '—'}本・止めているもの {stoppedCount ?? '—'}本</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月の実行（この30日）</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">{automaticRuns?.toLocaleString('ja-JP') ?? '—'}{automaticRuns !== null ? '回' : ''}</p>
          <p className="text-ink-faint mt-0.5 text-xs">分析の「使われ方」と同じ集計</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">失敗した</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">{failedRuns?.toLocaleString('ja-JP') ?? '—'}{failedRuns !== null ? '回' : ''}</p>
          <p className="text-ink-faint mt-0.5 text-xs">部分成功を含む・この30日</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">減らせた手作業</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">{estimatedHoursSaved !== null ? `およそ ${estimatedHoursSaved.toLocaleString('ja-JP')}時間` : '—'}</p>
          <p className="text-ink-faint mt-0.5 text-xs">1回30秒として計算しています</p>
        </div>
      </div>

      <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info">
        上から順に見て、当てはまったものが動きます。同じきっかけで2本が当てはまると両方が動くため、片方だけにしたいときは条件をずらしてください。
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="名前・きっかけ・することで検索"
          className="h-10 w-full max-w-lg rounded-control border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-info"
        />
        <div className="flex gap-2">
          <SelectField
            aria-label="表示期間"
            value="30"
            onChange={() => undefined}
            options={[{ value: '30', label: 'この30日' }]}
            className="h-10 min-w-32"
          />
          <SelectField
            aria-label="並び順"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as 'runs' | 'priority' | 'name')}
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
              onChange={() => setStatusFilter(value)}
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

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-canvas rounded-card border border-hairline p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規オートメーションを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 友だち追加時にウェルカムタグ付与"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">説明</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2}
                placeholder="ルールの説明 (省略可)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">イベントタイプ</label>
              <SelectField
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value as AutomationEventType })}
                options={eventTypeOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">アクション (JSON)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                rows={6}
                placeholder='[{"type": "add_tag", "params": {"tagId": "..."}}]'
                value={form.actionsJson}
                onChange={(e) => setForm({ ...form, actionsJson: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">条件 (JSON)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                rows={3}
                placeholder='{"tagId": "...", "operator": "equals"}'
                value={form.conditionsJson}
                onChange={(e) => setForm({ ...form, conditionsJson: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">優先度</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
              />
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 rounded-control px-4 py-2 min-h-[44px] text-sm font-medium disabled:opacity-50"
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
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
      ) : visibleAutomations.length === 0 && !showCreate ? (
        <ListState
          kind="empty"
          title={automations.length === 0
            ? (tab === 'stopped' ? '止めているオートメーションはありません。' : '動いているオートメーションはありません。')
            : '条件に合うオートメーションはありません。'}
          description={automations.length === 0 ? 'きっかけ・だれに・することの3つを決めると動きます。' : '検索語や絞り込みを変えてください。'}
          action={tab === 'active' ? <Button href="/automations/new" variant="primary">オートメーションをつくる</Button> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
          <div className="grid grid-cols-6 gap-3 bg-canvas-sunken px-4 py-3 text-xs font-semibold text-ink-faint">
            <span>きっかけ</span><span>だれに（条件）</span><span>すること</span><span>この30日</span><span>状態</span><span aria-hidden />
          </div>
          {visibleAutomations.slice(0, 6).map((automation) => (
            <div key={automation.id} className="grid min-h-14 grid-cols-6 items-center gap-3 border-t border-hairline px-4 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink" title={automation.name}>{automation.name}</p>
                <p className="truncate text-xs text-ink-faint" title={eventTypeLabelMap[automation.eventType]}>{eventTypeLabelMap[automation.eventType]}</p>
              </div>
              <p className="truncate text-ink-secondary" title={conditionLabel(automation.conditions)}>{conditionLabel(automation.conditions)}</p>
              <p className="truncate text-ink-secondary" title={automation.actions.map(actionLabel).join('、')}>{automation.actions.map(actionLabel).join('、') || '処理なし'}</p>
              <div>
                <span className="text-ink tabular-nums">{automation.executionCount30d.toLocaleString('ja-JP')}回</span>
                {automation.failureCount30d > 0 ? <span className="text-danger block text-[11px]">失敗が{automation.failureCount30d}回</span> : null}
              </div>
              <span className={automation.isActive ? 'font-semibold text-accent-deep' : 'font-semibold text-ink-faint'}>{automation.isActive ? '動いています' : '止めています'}</span>
              <div className="flex justify-end gap-2">
                <Button href={`/automations/drafts?id=${encodeURIComponent(automation.id)}`} className="whitespace-nowrap">中身を見る</Button>
                <Button onClick={() => void handleToggleActive(automation)} className="whitespace-nowrap">止める・動かす</Button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-ink-faint">
            <span>オートメーション {visibleAutomations.length}本中 1〜{Math.min(6, visibleAutomations.length)}本を表示</span>
            <span>前へ　<strong className="text-accent-deep">1</strong>　2　3　次へ</span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending === null
            ? ''
            : pending.kind === 'delete'
              ? `「${pending.automation.name}」を削除しますか？`
              : pending.automation.isActive
                ? `「${pending.automation.name}」を止めますか？`
                : `「${pending.automation.name}」を動かしますか？`
        }
        description={
          pending === null
            ? ''
            : pending.kind === 'delete'
              ? 'このルールの設定が消えます。すでに動いたぶん（付けたタグ・送ったメッセージ）はそのまま残り、取り消せません。この操作は取り消せません。'
              : pending.automation.isActive
                ? '止めているあいだ、このきっかけでは何も動きません。ルールの設定は残るので、あとから動かし直せます。'
                : 'これから起きるきっかけで動き始めます。止めているあいだに起きたぶんは、さかのぼって動きません。あとから止められます。'
        }
        confirmLabel={
          pending === null
            ? '実行する'
            : pending.kind === 'delete'
              ? '削除する'
              : pending.automation.isActive
                ? '止める'
                : '動かす'
        }
        /* 取り消せるのは稼働の切り替えだけ。赤は本当に戻せない削除に取っておく。
           戻せる操作にも赤を付けると、赤が「危ない」を意味しなくなる。 */
        destructive={pending?.kind === 'delete'}
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
              きっかけ：{eventTypeLabelMap[pending.automation.eventType]} ／ アクション{' '}
              {pending.automation.actions.length}件
            </p>
            {pending.automation.lineAccountId === null && (
              <p className="text-warning font-medium">
                全アカウント共通のルールです。
                {pending.kind === 'delete'
                  ? 'すべてのアカウントから消えます。'
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
