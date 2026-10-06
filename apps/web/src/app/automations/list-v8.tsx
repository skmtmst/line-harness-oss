'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, fetchApi } from '@/lib/api'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import MergedTabs from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel from '@/components/shared/folder-panel'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { RowActions } from '@/components/shared/row-actions'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { Field, TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th, TableStateRow } from '@/components/shared/table'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import { formatNumber } from '@/lib/format'
import {
  automationActionLabel,
  automationTriggerLabel,
  type Automation as SharedAutomation,
} from '@line-crm/shared'
import styles from './automation-api-v8.module.css'

/*
 * ★V8 オートメーション一覧（板 `LWQXd`）。
 * v8 のときだけ出す枝。v7 の `page.tsx` には触らない。
 */

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

type LoadStatus = 'loading' | 'ready' | 'error'

type RunsSummary = {
  total: number
  executed: number
  skipped: number
  failed: number
  mostRunName: string | null
  mostRunCount: number | null
}

/** 道具の並び順（「よく使う絞り込み」）。 */
const SORT_OPTIONS = [
  { value: 'runs', label: '動いた回数が多い順' },
  { value: 'name', label: '名前順' },
  { value: 'newest', label: '新しく作った順' },
] as const

type SortKey = (typeof SORT_OPTIONS)[number]['value']

function conditionSummary(conditions: Record<string, unknown>): string {
  const keyword = typeof conditions.keyword === 'string' ? conditions.keyword.trim() : ''
  if (keyword) return `「${keyword}」を含む人`
  if (Object.keys(conditions).length === 0) return '全員'
  return '登録した条件'
}

function actionSummary(item: Automation): { title: string; detail: string } {
  const [first, ...rest] = item.actions
  if (!first) return { title: '登録した処理', detail: '' }
  const firstType = first.type as string
  const firstParams = first.params as Record<string, unknown>
  const title = automationActionLabel(firstType)
  const second = (() => {
    if (firstType === 'notify_staff') {
      const targets = Array.isArray(firstParams.notifyStaffIds)
        ? firstParams.notifyStaffIds.length
        : 0
      return targets > 0 ? `${targets}人に知らせる` : '担当へ知らせる'
    }
    if (firstType === 'add_tag' && typeof firstParams.tagId === 'string' && firstParams.tagId) {
      return 'タグを付ける'
    }
    if (firstType === 'start_scenario' && typeof firstParams.scenarioId === 'string' && firstParams.scenarioId) {
      return 'シナリオを始める'
    }
    if (firstType === 'common_action') return '共通アクション'
    if (firstType === 'send_message') return 'メッセージを送る'
    return ''
  })()
  const more = rest.length > 0 ? `・ほか${rest.length}件` : ''
  return { title, detail: `${second}${more}`.trim() }
}

export default function AutomationListV8() {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useCanManageAutomations()
  const viewerOnly = canManage === false
  usePageTitle('オートメーション')
  const [items, setItems] = useState<Automation[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [summary, setSummary] = useState<{ active: number; stopped: number; executionCount30d: number; failureCount30d: number } | null>(null)
  const [skipped, setSkipped] = useState<number | null>(null)
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [commonActionCount, setCommonActionCount] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [showActive, setShowActive] = useState(true)
  const [showStopped, setShowStopped] = useState(true)
  const [sort, setSort] = useState<SortKey>('runs')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [pending, setPending] = useState<{ kind: 'toggle' | 'archive'; item: Automation } | null>(null)
  const [working, setWorking] = useState(false)
  const [testing, setTesting] = useState<Automation | null>(null)
  const [testFriendId, setTestFriendId] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState('')
  const [testDone, setTestDone] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoadStatus('loading')
    setActionError('')
    try {
      const [listRes, templatesRes, commonRes, runsRes] = await Promise.all([
        api.automations.list({ accountId: selectedAccountId || undefined }),
        selectedAccountId ? api.automations.templates(selectedAccountId).catch(() => null) : Promise.resolve(null),
        selectedAccountId ? api.commonActions.list({ accountId: selectedAccountId }).catch(() => null) : Promise.resolve(null),
        selectedAccountId
          ? fetchApi<ApiResponse<{ summary: RunsSummary }>>(
            `/api/automation-runs?lineAccountId=${encodeURIComponent(selectedAccountId)}&limit=1`,
          ).catch(() => null)
          : Promise.resolve(null),
      ])
      if (requestId !== requestRef.current) return
      if (!listRes.success) throw new Error(listRes.error)
      setItems(listRes.data as Automation[])
      setSummary(listRes.summary ?? null)
      setSkipped(runsRes && runsRes.success ? runsRes.data.summary.skipped : null)
      setTemplateCount(templatesRes && templatesRes.success ? templatesRes.data.length : null)
      setCommonActionCount(commonRes && commonRes.success ? commonRes.data.length : null)
      setLoadStatus('ready')
    } catch {
      if (requestId !== requestRef.current) return
      setItems([])
      setSummary(null)
      setSkipped(null)
      setLoadStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
    return () => { requestRef.current += 1 }
  }, [accountLoading, load])

  const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items])
  const stoppedCount = useMemo(() => items.length - activeCount, [items, activeCount])
  /** 一度も動いていない動かしているルール（条件に外れたままの目安）。 */
  const neverRunCount = useMemo(
    () => items.filter((item) => item.isActive && item.executionCount30d === 0).length,
    [items],
  )

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ja')
    const filtered = items.filter((item) => {
      if (item.isActive && !showActive) return false
      if (!item.isActive && !showStopped) return false
      if (!query) return true
      const actions = item.actions.map((action) => automationActionLabel(action.type)).join(' ')
      return `${item.name} ${item.description ?? ''} ${automationTriggerLabel(item.eventType)} ${actions}`
        .toLocaleLowerCase('ja')
        .includes(query)
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
      if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt)
      return b.executionCount30d - a.executionCount30d || a.name.localeCompare(b.name, 'ja')
    })
  }, [items, search, showActive, showStopped, sort])

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const paged = visible.slice((current - 1) * pageSize, current * pageSize)

  const runRowAction = async (fn: () => Promise<void>, id: string) => {
    if (rowBusyId) return
    setRowBusyId(id)
    setActionError('')
    try {
      await fn()
      await load()
    } catch {
      setActionError('操作できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setRowBusyId(null)
    }
  }

  const openEditor = async (id: string, duplicate: boolean) => {
    const fn = duplicate ? api.automations.duplicate(id) : api.automations.createDraftFromAutomation(id)
    await runRowAction(async () => {
      const res = await fn
      if (!res.success) throw new Error(res.error)
      router.push(`/automations/drafts?id=${encodeURIComponent(res.data.id)}`)
    }, id)
  }

  const confirmPending = async () => {
    if (!pending || working) return
    setWorking(true)
    setActionError('')
    try {
      const status = pending.kind === 'archive' ? 'archived' : pending.item.isActive ? 'stopped' : 'active'
      const res = await api.automations.setStatus(pending.item.id, status)
      if (!res.success) throw new Error(res.error)
      setPending(null)
      await load()
    } catch {
      setActionError(
        pending.kind === 'archive'
          ? 'このルールを削除できませんでした。状態を読み直してから、もう一度お試しください。'
          : '稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setWorking(false)
    }
  }

  const runSingleTest = async () => {
    if (!testing || !selectedAccountId || testBusy) return
    const friendId = testFriendId.trim()
    if (!friendId) {
      setTestError('試す友だちのIDを入力してください')
      return
    }
    setTestBusy(true)
    setTestError('')
    try {
      const res = await api.automations.test(testing.id, selectedAccountId, friendId)
      if (!res.success) throw new Error(res.error)
      setTestDone(true)
    } catch {
      setTestError('試しに動かせませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setTestBusy(false)
    }
  }

  const closeTestDialog = () => {
    setTesting(null)
    setTestFriendId('')
    setTestError('')
    setTestDone(false)
  }

  if (accountLoading) return <ListState kind="loading" title="オートメーションを読み込んでいます" />
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="選んだアカウントのルールだけを表示します。" />
  }

  const tabs = [
    { key: 'rules', label: `ルール ${loadStatus === 'ready' ? items.length : '—'}` },
    { key: 'common-actions', label: `共通アクション ${commonActionCount ?? '—'}`, href: '/common-actions' },
    { key: 'runs', label: '動いた記録', href: '/automations/runs' },
    { key: 'templates', label: `見本 ${templateCount ?? '—'}`, href: '/automations?tab=templates' },
  ]

  return (
    <div className={styles.board} data-design-node="LWQXd">
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>オートメーション</h1>
          <p className={styles.lead}>「○○したら△△する」を決めておくと、友だちの動きに合わせて自動で動きます。</p>
        </div>
        <Button href="/automations?tab=templates" variant="secondary">見本から作る</Button>
      </div>

      <MergedTabs basePath="/automations" paramName="tab" tabs={tabs} active="rules" />

      {loadStatus === 'ready' ? (
        <div data-design="KPIs" className={`${kpiStyles.strip} ${styles.kpis}`}>
          <KpiCard title="ルール" value={items.length} unit="件" detail={`動いている ${activeCount}・止めている ${stoppedCount}`} />
          <KpiCard title="今月動いた" value={summary?.executionCount30d ?? null} unit="回" detail="この30日の実行回数です" />
          <KpiCard title="失敗" value={summary?.failureCount30d ?? null} unit="件" detail="「動いた記録」からやり直せます" />
          <KpiCard title="条件に外れた" value={skipped} unit="回" detail={`だれにも当たらないルール ${neverRunCount}`} />
        </div>
      ) : null}

      {loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="ルールを表示できませんでした"
          description="ルールは消えていません。通信を確かめて、もう一度お試しください。"
          action={<Button variant="secondary" onClick={() => void load()}>もう一度読み込む</Button>}
        />
      ) : null}

      {loadStatus === 'loading' ? <ListState kind="loading" title="ルールを読み込んでいます" /> : null}

      {loadStatus === 'ready' ? (
        <div className={styles.railGrid}>
          <div className={styles.railSide}>
            {canManage ? (
              <Button href="/automations/new" variant="primary">＋ ルールを作る</Button>
            ) : (
              <span className={styles.subLine}>操作する権限がありません</span>
            )}
            {/*
              分類の口が無いので「すべて」だけ出す。口が来たらここへ足す。
              今の作りの形のまま（推測の分類は作らない）。
            */}
            <FolderPanel
              total={`${items.length}件`}
              activeId=""
              onSelect={() => undefined}
              rows={[{ id: '', label: 'すべて', count: items.length }]}
            />
          </div>

          <div className={styles.railMain}>
            <Notice tone="info" className={styles.noticeBand}>
              ルールは1人で試してから動かすと、まちがいを防げます。動いた結果は「動いた記録」で見られます。
            </Notice>

            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <SearchField
                  aria-label="ルールを検索"
                  placeholder="ルール名・きっかけで探す"
                  value={search}
                  onChange={(value) => { setSearch(value); setPage(1) }}
                  onClear={() => { setSearch(''); setPage(1) }}
                />
              </div>
              <FilterChip selected={showActive} onChange={(selected) => { setShowActive(selected); setPage(1) }}>
                {`動いている ${activeCount}`}
              </FilterChip>
              <FilterChip selected={showStopped} onChange={(selected) => { setShowStopped(selected); setPage(1) }}>
                {`止めている ${stoppedCount}`}
              </FilterChip>
              <div className={styles.toolbarSpice}>
                <div className={styles.selectWrap}>
                  <Select
                    aria-label="よく使う絞り込み"
                    label="よく使う絞り込み"
                    value={sort}
                    options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    onChange={(value) => { setSort(value as SortKey); setPage(1) }}
                  />
                </div>
                <div className={styles.pageSizeWrap}>
                  <Select
                    aria-label="表示件数"
                    label="表示件数"
                    value={String(pageSize)}
                    options={[
                      { value: '10', label: '10件表示' },
                      { value: '20', label: '20件表示' },
                      { value: '50', label: '50件表示' },
                    ]}
                    onChange={(value) => { setPageSize(Number(value) || 20); setPage(1) }}
                  />
                </div>
              </div>
            </div>

            {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

            <div className={styles.tableWrap}>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <TableHeadRow>
                    <Th>ルール</Th>
                    <Th>きっかけ</Th>
                    <Th>だれに（条件）</Th>
                    <Th>すること</Th>
                    <Th align="right">この30日</Th>
                    <Th>状態</Th>
                    <Th>操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {paged.map((item) => {
                    const action = actionSummary(item)
                    const busy = rowBusyId === item.id
                    return (
                      <tr key={item.id}>
                        <td><span className={styles.ruleName}>{item.name}</span></td>
                        <td>{automationTriggerLabel(item.eventType)}</td>
                        <td>{conditionSummary(item.conditions)}</td>
                        <td>
                          <span className={styles.cellStack}>
                            <span>{action.title}</span>
                            {action.detail ? <span className={styles.subLine}>{action.detail}</span> : null}
                          </span>
                        </td>
                        <td align="right">
                          <span className={styles.cellStack}>
                            <span className="tabular-nums">{formatNumber(item.executionCount30d)}回</span>
                            <span className={styles.subLine}>失敗{formatNumber(item.failureCount30d)}回</span>
                          </span>
                        </td>
                        <td>
                          {item.isActive ? <Chip tone="ok">動いています</Chip> : <Chip tone="neutral">止めています</Chip>}
                        </td>
                        <td>
                          <RowActions
                            subjectName={item.name}
                            edit={canManage ? { label: '編集する', onClick: () => void openEditor(item.id, false), disabled: busy } : undefined}
                            menuItems={canManage ? [
                              { id: 'test', label: '1人で試す', disabled: busy, onSelect: () => { setTesting(item); setTestFriendId(''); setTestError(''); setTestDone(false) } },
                              { id: 'duplicate', label: '複製する', disabled: busy, onSelect: () => void openEditor(item.id, true) },
                              {
                                id: 'toggle',
                                label: item.isActive ? '止める' : '動かす',
                                disabled: busy,
                                onSelect: () => setPending({ kind: 'toggle', item }),
                              },
                              { id: 'runs', label: '動いた記録を見る', disabled: busy, onSelect: () => router.push(`/automations/runs?search=${encodeURIComponent(item.name)}`) },
                            ] : [
                              { id: 'runs', label: '動いた記録を見る', disabled: busy, onSelect: () => router.push(`/automations/runs?search=${encodeURIComponent(item.name)}`) },
                            ]}
                            destructiveItem={canManage ? { id: 'archive', label: '削除する', disabled: busy, onSelect: () => setPending({ kind: 'archive', item }) } : undefined}
                          />
                        </td>
                      </tr>
                    )
                  })}
                  {paged.length === 0 ? (
                    <TableStateRow
                      colSpan={7}
                      kind="empty"
                      title="条件に合うルールはありません"
                      description="探す言葉や札を変えてください。"
                    />
                  ) : null}
                </tbody>
              </table>
            </div>

            <Pagination page={current} pageCount={pageCount} onPageChange={setPage} summary={`全 ${visible.length} 件`} />
            <p className={styles.footnote}>行の「…」から 編集・複製・1人で試す・止める・動いた記録を見る・削除。</p>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `「${pending.item.name}」を${pending.kind === 'archive' ? '削除' : pending.item.isActive ? '止め' : '動か'}ますか？` : ''}
        description={
          pending?.kind === 'archive'
            ? '一覧から隠します。動いた記録と設定は残りますが、この画面からは元に戻せません。必要なら複製して作り直してください。'
            : '切り替えても、動いた記録は残ります。'
        }
        confirmLabel={pending?.kind === 'archive' ? '削除する' : pending?.item.isActive ? '止める' : '動かす'}
        destructive={pending?.kind === 'archive'}
        busy={working}
        error={actionError}
        onConfirm={() => void confirmPending()}
        onCancel={() => { if (!working) setPending(null) }}
      />

      <Dialog
        open={testing !== null}
        onCancel={closeTestDialog}
        title={testing ? `「${testing.name}」を1人で試す` : ''}
        description="選んだ友だち1人に、保存されている内容のまま動かします。取り消せません。"
        footer={testing && !testDone ? (
          <>
            <Button variant="secondary" onClick={closeTestDialog}>やめる</Button>
            <Button onClick={() => void runSingleTest()} disabled={testBusy || !testFriendId.trim()} busy={testBusy} busyLabel="動かしています…">試しに動かす</Button>
          </>
        ) : (
          <Button onClick={closeTestDialog}>閉じる</Button>
        )}
      >
        {testing ? (
          <div>
            <Field label="試す友だちのID">
              <TextInput
                aria-label="試す友だちのID"
                value={testFriendId}
                onChange={(event) => setTestFriendId(event.target.value)}
                placeholder="試す友だちID"
                disabled={testBusy || testDone}
              />
            </Field>
            <p className={styles.subLine}>
              すること：{testing.actions.map((action) => automationActionLabel(action.type)).join('・') || '登録した処理'}
            </p>
            {testError ? <Notice tone="danger">{testError}</Notice> : null}
            {testDone ? <Notice tone="info">試しに動かしました。「動いた記録」で結果を確かめてください。</Notice> : null}
          </div>
        ) : null}
      </Dialog>

      {viewerOnly ? <p className={styles.subLine}>閲覧のみのため、作る・変える操作は出していません。</p> : null}
    </div>
  )
}
