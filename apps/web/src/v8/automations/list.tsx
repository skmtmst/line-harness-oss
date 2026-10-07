'use client'

/*
 * ★V8 オートメーションのルール一覧（Pencil：一覧 `LWQXd`・1152 `En14p`・閲覧のみ `nH9L8`）。
 *
 * 2026-10-06 オーナー決定で src/v8 に一から書いた。データの口・保存・権限・失敗時の扱いは
 * 今までの V8 一覧（app/automations/list-v8.tsx）と同じ（BEHAVIOR.md）。違いは見せ方だけ——
 * 型（ListPage）に、タブ・数の帯・左のフォルダの列（上に「ルールを作る」）・案内の帯・
 * 道具の段・表（絵の列の並び）を渡す。行の右端は「編集する」と「…」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  Bookmark,
  FileWarning,
  Filter,
  LayoutTemplate,
  ListChecks,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Zap,
} from 'lucide-react'
import {
  automationActionLabel,
  automationTriggerLabel,
  type Folder,
} from '@line-crm/shared'
import { api, fetchApi, type AutomationListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatNumber } from '@/lib/format'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import IconButton from '@/components/shared/icon-button'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import {
  AUTOMATIONS_DESCRIPTION,
  AutomationBand,
  AutomationTabs,
  READONLY_REASON,
  ViewerBand,
  automationTabHref,
  useAutomationManage,
  useAutomationTabCounts,
  type BandCell,
} from './shell'
import styles from './list.module.css'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }
type LoadStatus = 'loading' | 'ready' | 'error'
type Automation = AutomationListItem

type RunsSummary = {
  total: number
  executed: number
  skipped: number
  failed: number
}

/** よく使う絞り込み（数えられるものだけ）と並び。既定は更新が新しい順（絵の並び）。 */
type SavedKey = '' | 'failed' | 'idle' | 'runs' | 'name'
const SAVED_OPTIONS: Array<{ value: SavedKey; label: string }> = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'failed', label: '失敗があったルール' },
  { value: 'idle', label: 'この30日に動いていないルール' },
  { value: 'runs', label: '動いた回数が多い順' },
  { value: 'name', label: '名前順' },
]

const UNFILED = '__unfiled__'

/** きっかけの1行。言葉で動くものは言葉まで（「〇〇」と送られた）、ほかは正本の名前。 */
export function triggerSummary(item: Pick<Automation, 'eventType' | 'triggerConfig' | 'conditions'>): string {
  const config = item.triggerConfig ?? {}
  const keyword = typeof config.keyword === 'string' ? config.keyword.trim() : ''
  if (item.eventType === 'message_received' && keyword) return `「${keyword}」と送られた`
  return automationTriggerLabel(item.eventType)
}

/** だれに（条件）の1行。条件が無ければ全員。 */
export function conditionSummary(conditions: Record<string, unknown>): string {
  const keyword = typeof conditions.keyword === 'string' ? conditions.keyword.trim() : ''
  if (keyword) return `「${keyword}」を含む人`
  if (Object.keys(conditions).length === 0) return '全員'
  return '登録した条件'
}

/** すること：1行目に最初の処理、2行目に残りの処理（正本の名前）。 */
export function actionSummary(item: Pick<Automation, 'actions'>): { title: string; detail: string } {
  const [first, ...rest] = item.actions
  if (!first) return { title: '登録した処理', detail: '' }
  return {
    title: automationActionLabel(first.type),
    detail: rest.map((action) => automationActionLabel(action.type)).join('・'),
  }
}

/** 月/日（日本時間）。 */
function monthDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).formatToParts(date)
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${month}/${day}`
}

function TableHead() {
  return (
    <thead>
      <TableHeadRow className={styles.headRow} data-table-layout="columns">
        <Th className={styles.colName}>ルール</Th>
        <Th className={styles.colTrigger}>きっかけ</Th>
        <Th className={styles.colWho}>だれに（条件）</Th>
        <Th className={styles.colDo}>すること</Th>
        <Th className={styles.colRuns} align="right">この30日</Th>
        <Th className={styles.colState}>状態</Th>
        <Th className={styles.colOps}>操作</Th>
      </TableHeadRow>
    </thead>
  )
}

export default function AutomationListV8() {
  usePageTitle('オートメーション')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  // 1152 の板（`En14p`）。道具の段の並びと列だけを切り替える。
  const narrow = useNarrowViewport()
  /*
   * 閲覧のみ（変える権限が無い人）：作る・編集・複製・1人で試す・止める・削除・フォルダを追加は
   * 置かずに隠す（場所だけ空ける。2026-10-06 オーナー決定）。役割が読めるまで（null）は今までどおり出す。
   */
  const canManage = useAutomationManage()
  const canEdit = canManage !== false
  const viewerOnly = canManage === false

  const [items, setItems] = useState<Automation[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [summary, setSummary] = useState<{ executionCount30d: number; failureCount30d: number } | null>(null)
  const [skipped, setSkipped] = useState<number | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  /* ?search= で開くと、その言葉で探した状態から始める（動いた記録の「ルールを開く」）。 */
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '')
  const [onlyActive, setOnlyActive] = useState(false)
  const [onlyStopped, setOnlyStopped] = useState(false)
  const [saved, setSaved] = useState<SavedKey>('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
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
      const [listRes, runsRes] = await Promise.all([
        api.automations.list({ accountId: selectedAccountId || undefined }),
        selectedAccountId
          ? fetchApi<ApiResponse<{ summary: RunsSummary }>>(
            `/api/automation-runs?lineAccountId=${encodeURIComponent(selectedAccountId)}&limit=1`,
          ).catch(() => null)
          : Promise.resolve(null),
      ])
      if (requestId !== requestRef.current) return
      if (!listRes.success) throw new Error(listRes.error)
      setItems(listRes.data)
      setSummary(listRes.summary ?? null)
      setSkipped(runsRes && runsRes.success ? runsRes.data.summary.skipped : null)
      setLoadStatus('ready')
    } catch {
      if (requestId !== requestRef.current) return
      setItems([])
      setSummary(null)
      setSkipped(null)
      setLoadStatus('error')
    }
  }, [selectedAccountId])

  /* フォルダの箱（kind=automation）。ルールをフォルダへ入れる口がまだ無いので、件数は出さない。 */
  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) { setFolders([]); return }
    try {
      const res = await api.folders.list('automation', selectedAccountId)
      setFolders(res.success ? res.data : [])
    } catch {
      setFolders([])
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
    return () => { requestRef.current += 1 }
  }, [accountLoading, load])
  useEffect(() => { void loadFolders() }, [loadFolders])
  useEffect(() => { setFolderFilter('') }, [selectedAccountId])

  const tabCounts = useAutomationTabCounts(loadStatus === 'ready' ? items.length : null)

  const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items])
  const stoppedCount = items.length - activeCount
  /** 動かしているのに、この30日に一度も動いていないルール（だれにも当たらない目安）。 */
  const neverRunCount = useMemo(() => items.filter((item) => item.isActive && item.executionCount30d === 0).length, [items])

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ja')
    const filtered = items.filter((item) => {
      // ルールを入れる口がまだ無いので、フォルダを選ぶと「未分類」以外は0件。
      if (folderFilter && folderFilter !== UNFILED) return false
      if (onlyActive && !item.isActive) return false
      if (onlyStopped && item.isActive) return false
      if (saved === 'failed' && item.failureCount30d === 0) return false
      if (saved === 'idle' && item.executionCount30d > 0) return false
      if (!query) return true
      const actions = item.actions.map((action) => automationActionLabel(action.type)).join(' ')
      return `${item.name} ${item.description ?? ''} ${automationTriggerLabel(item.eventType)} ${triggerSummary(item)} ${actions}`
        .toLocaleLowerCase('ja')
        .includes(query)
    })
    return [...filtered].sort((a, b) => {
      if (saved === 'name') return a.name.localeCompare(b.name, 'ja')
      if (saved === 'runs') return b.executionCount30d - a.executionCount30d || a.name.localeCompare(b.name, 'ja')
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [items, search, folderFilter, onlyActive, onlyStopped, saved])

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const paged = visible.slice((current - 1) * pageSize, current * pageSize)
  useEffect(() => { setPage(1) }, [search, folderFilter, onlyActive, onlyStopped, saved, pageSize, selectedAccountId])

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

  /* 「編集する」は改訂用の下書きを作って（あれば同じ下書き）開く。「複製する」は写しの下書き。 */
  const openEditor = async (id: string, duplicate: boolean) => {
    await runRowAction(async () => {
      const res = duplicate ? await api.automations.duplicate(id) : await api.automations.createDraftFromAutomation(id)
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

  const runsHref = (item: Automation) => `${automationTabHref('runs')}?search=${encodeURIComponent(item.name)}`

  /* 行の「…」：編集・複製・1人で試す・止める・動いた記録を見る・削除（閲覧のみは動いた記録だけ）。 */
  const rowMenuItems = (item: Automation): ActionMenuItem[] => {
    const busy = rowBusyId === item.id
    const runs: ActionMenuItem = { id: 'runs', label: '動いた記録を見る', onSelect: () => router.push(runsHref(item)) }
    if (!canEdit) return [runs]
    return [
      { id: 'edit', label: '編集する', disabled: busy, onSelect: () => void openEditor(item.id, false) },
      { id: 'duplicate', label: '複製する', disabled: busy, onSelect: () => void openEditor(item.id, true) },
      {
        id: 'test',
        label: '1人で試す',
        disabled: busy,
        onSelect: () => { setTesting(item); setTestFriendId(''); setTestError(''); setTestDone(false) },
      },
      { id: 'toggle', label: item.isActive ? '止める' : '動かす', disabled: busy, onSelect: () => setPending({ kind: 'toggle', item }) },
      runs,
      { id: 'archive', label: '削除する', tone: 'danger', dividerBefore: true, disabled: busy, onSelect: () => setPending({ kind: 'archive', item }) },
    ]
  }

  /* ===== 数の帯（4つ） ===== */
  const ready = loadStatus === 'ready'
  const cells: BandCell[] = [
    { key: 'rules', title: 'ルール', icon: <ListChecks size={13} aria-hidden="true" />, value: ready ? items.length : null, unit: '件', detail: ready ? `動いている ${activeCount}・止めている ${stoppedCount}` : '—' },
    { key: 'runs', title: '今月動いた', icon: <Activity size={13} aria-hidden="true" />, value: summary?.executionCount30d ?? null, unit: '回', detail: 'この30日に動いた回数' },
    { key: 'failed', title: '失敗', icon: <FileWarning size={13} aria-hidden="true" />, value: summary?.failureCount30d ?? null, unit: '件', detail: '「動いた記録」からやり直せます' },
    { key: 'skipped', title: '条件に外れた', icon: <Filter size={13} aria-hidden="true" />, value: skipped, unit: '回', detail: ready ? `だれにも当たらないルール ${neverRunCount}` : '—' },
  ]

  /* ===== フォルダ ===== */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: ready ? items.length : null },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: null, color: folder.color })),
    { id: UNFILED, label: '未分類', count: ready ? items.length : null },
  ]
  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value={folderFilter}
      onChange={setFolderFilter}
      options={[
        { value: '', label: 'フォルダ：すべて' },
        ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })),
        { value: UNFILED, label: 'フォルダ：未分類' },
      ]}
    />
  )
  /* 閲覧のみには押せない「ルールを作る」を置かない（場所だけ空ける）。 */
  const createButton = (full: boolean) => canEdit ? (
    <Button variant="primary" href="/automations/new" className={full ? 'v8-folder-create w-full' : undefined}>
      <Plus size={15} aria-hidden="true" />ルールを作る
    </Button>
  ) : <span className={full ? styles.createSpace : styles.createSpaceInline} aria-hidden="true" />

  /* ===== 道具の段 ===== */
  const filterChips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip selected={onlyActive} onChange={(next) => { setOnlyActive(next); if (next) setOnlyStopped(false) }} icon={<Play size={13} aria-hidden="true" />}>
        {`動いている ${ready ? activeCount : '—'}`}
      </FilterChip>
      <FilterChip selected={onlyStopped} onChange={(next) => { setOnlyStopped(next); if (next) setOnlyActive(false) }} icon={<Pause size={13} aria-hidden="true" />}>
        {`止めている ${ready ? stoppedCount : '—'}`}
      </FilterChip>
    </div>
  )
  const savedBox = (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select aria-label="よく使う絞り込み" value={saved} onChange={(value) => setSaved(value as SavedKey)} options={SAVED_OPTIONS} />
    </div>
  )
  const perPageBox = <PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} label={null} />
  const notice = (
    <div className={styles.noticeRow}>
      <Notice tone="info">ルールは1人で試してから動かすと、まちがいを防げます。動いた結果は「動いた記録」で見られます。</Notice>
    </div>
  )
  /* 1152 の板（En14p）：案内の帯 → 1段目「作る・フォルダ・探す」→ 2段目「札 … よく使う絞り込み・件数」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      {notice}
      <div className={styles.narrowRow}>
        {createButton(false)}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>
          <SearchField
            value={search}
            onChange={setSearch}
            onClear={() => setSearch('')}
            placeholder="ルール名・きっかけで探す"
            aria-label="ルールを検索"
          />
        </div>
      </div>
      <div className={styles.narrowRow}>
        {filterChips}
        <span className={styles.spacer} aria-hidden="true" />
        {savedBox}
        {perPageBox}
      </div>
    </div>
  )
  const wideToolbar = (
    <>
      {notice}
      <ListToolbar
        search={{ placeholder: 'ルール名・きっかけで探す', label: 'ルールを検索', width: 240, value: search, onChange: setSearch }}
        filters={filterChips}
        trailing={<>{savedBox}{perPageBox}</>}
      />
    </>
  )

  /* ===== 表 ===== */
  let listBody: ReactNode
  if (accountLoading || loadStatus === 'loading') {
    listBody = <ListState kind="loading" title="ルールを読み込んでいます" />
  } else if (!selectedAccountId) {
    listBody = <ListState kind="empty" title="LINE公式アカウントを選んでください" description="選んだアカウントのルールだけを表示します。" />
  } else if (loadStatus === 'error') {
    listBody = (
      <ListState
        kind="error"
        title="ルールを読み込めませんでした"
        description="ルールは消えていません。通信を確かめて、もう一度お試しください。"
        action={<Button variant="secondary" onClick={() => void load()}>もう一度試す</Button>}
      />
    )
  } else if (paged.length === 0) {
    /* 修正案 D-2：空の一覧。 */
    listBody = (
      <EmptyList
        icon={<Zap aria-hidden="true" />}
        title="まだオートメーションがありません"
        description="「友だち追加でお礼を送る」など、決めた動きを自動で続けます。"
        create={{ label: '最初のオートメーションを作る', href: '/automations/new' }}
        canCreate={canEdit}
        filtered={items.length > 0}
        onClearFilters={() => { setSearch(''); setOnlyActive(false); setOnlyStopped(false); setSaved(''); setFolderFilter('') }}
        filteredDescription="検索や絞り込みの札を外すと、すべて出ます"
      />
    )
  } else {
    listBody = (
      <>
        {actionError ? <div className={styles.errorRow}><Notice tone="danger">{actionError}</Notice></div> : null}
        <div className={narrow ? `${styles.tableWrap} ${styles.narrowTable}` : styles.tableWrap}>
          <DataTable className={styles.table}>
            <TableHead />
            <tbody>
              {paged.map((item) => {
                const action = actionSummary(item)
                const busy = rowBusyId === item.id
                const menuLabel = `ルール「${item.name}」の操作`
                const trigger = triggerSummary(item)
                const who = conditionSummary(item.conditions)
                return (
                  <Tr key={item.id} className={styles.row} data-table-layout="columns" data-row-id={item.id}>
                    <Td className={styles.colName}>
                      <span className={styles.name} title={item.name}>{item.name}</span>
                    </Td>
                    <Td className={styles.colTrigger}><span className={styles.cell} title={trigger}>{trigger}</span></Td>
                    <Td className={styles.colWho}><span className={styles.cell} title={who}>{who}</span></Td>
                    <Td className={styles.colDo}>
                      <span className={styles.cellOne} title={action.title}>{action.title}</span>
                      {action.detail ? <span className={styles.sub} title={action.detail}>{action.detail}</span> : null}
                    </Td>
                    <Td className={styles.colRuns}>
                      <span className={styles.numMain}>{`${formatNumber(item.executionCount30d)}回`}</span>
                      <span className={styles.numSub}>
                        {item.isActive ? `失敗 ${formatNumber(item.failureCount30d)}回` : `更新 ${monthDay(item.updatedAt)}`}
                      </span>
                    </Td>
                    <Td className={styles.colState}>
                      <span className={styles.pill} data-tone={item.isActive ? 'active' : 'neutral'}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {item.isActive ? '動いています' : '止めています'}
                      </span>
                    </Td>
                    <Td className={styles.colOps}>
                      <div className={styles.opsBox}>
                        {canEdit
                          ? <Button onClick={() => void openEditor(item.id, false)} disabled={busy}>編集する</Button>
                          : <span className={styles.editSpace} aria-hidden="true" />}
                        <IconButton
                          title={menuLabel}
                          aria-label={menuLabel}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === item.id}
                          onClick={() => setOpenMenuId((currentId) => (currentId === item.id ? null : item.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu
                          open={openMenuId === item.id}
                          onClose={() => setOpenMenuId(null)}
                          ariaLabel={menuLabel}
                          note={canEdit ? undefined : READONLY_REASON}
                          items={rowMenuItems(item).map((menuItem) => ({ ...menuItem, onSelect: () => { setOpenMenuId(null); menuItem.onSelect() } }))}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
        <p className={styles.footNote}>
          {canEdit
            ? '行の「…」から 編集・複製・1人で試す・止める・動いた記録を見る・削除。'
            : '行の「…」から 動いた記録を見る。'}
        </p>
      </>
    )
  }

  const pager = ready && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {(current - 1) * pageSize + 1}〜{(current - 1) * pageSize + paged.length} / {formatNumber(visible.length)}件
      </span>
      <Pagination page={current} pageCount={pageCount} onPageChange={setPage} ariaLabel="ルール一覧のページ送り" />
    </ListPagePagination>
  ) : null

  return (
    <ListPage
      boardId={narrow ? 'En14p' : viewerOnly ? 'nH9L8' : 'LWQXd'}
      headingSize="regular"
      title="オートメーション"
      description={AUTOMATIONS_DESCRIPTION}
      actions={canEdit
        ? <Button href={automationTabHref('templates')}><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button>
        : <span className={styles.createSpaceInline} aria-hidden="true" />}
      tabs={<AutomationTabs active="rules" counts={tabCounts} />}
      stats={<>
        {viewerOnly ? <ViewerBand /> : null}
        <AutomationBand label="ルールの数の帯" cells={cells} />
      </>}
      folders={<>
        {createButton(true)}
        <FolderPanel
          activeId={folderFilter}
          onSelect={setFolderFilter}
          onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
          addFolderLabel="フォルダを追加"
          rows={folderRows}
        >
          {/* 閲覧のみには押せない「フォルダを追加」を置かない（場所だけ空ける）。 */}
          {canEdit ? null : <span className={styles.addSpace} aria-hidden="true" />}
          <p className={styles.folderNote}>フォルダを消しても、中のルールは未分類に残ります</p>
        </FolderPanel>
      </>}
      collapsedFolders={narrow ? undefined : <>{createButton(false)}{folderSelect}</>}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={pager}
      overlays={<>
        {folderDialogOpen ? (
          <FolderAddDialog
            kind="automation"
            accountId={selectedAccountId}
            note="ルールを分けてしまう箱です。消しても、入っていたルールは未分類として残ります。"
            placeholder="例: 予約・購入"
            onClose={() => setFolderDialogOpen(false)}
            onAdded={() => void loadFolders()}
          />
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
            <div className={styles.testBody}>
              <Field label="試す友だちのID">
                <TextField
                  aria-label="試す友だちのID"
                  value={testFriendId}
                  onChange={(event) => setTestFriendId(event.target.value)}
                  placeholder="試す友だちID"
                  disabled={testBusy || testDone}
                />
              </Field>
              <p className={styles.testNote}>
                すること：{testing.actions.map((action) => automationActionLabel(action.type)).join('・') || '登録した処理'}
              </p>
              {testError ? <Notice tone="danger">{testError}</Notice> : null}
              {testDone ? <Notice tone="info">試しに動かしました。「動いた記録」で結果を確かめてください。</Notice> : null}
            </div>
          ) : null}
        </Dialog>
      </>}
    >
      {listBody}
    </ListPage>
  )
}
