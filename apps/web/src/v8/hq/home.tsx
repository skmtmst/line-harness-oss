'use client'

import { DataTable, Tr, Th, Td, PersonCell, TableHeadRow } from '@/components/shared/table';
import { useListUrlValue } from '@/components/shared/list-url-state';
import { Inbox, LayoutGrid, List, LogIn, Plus, RotateCcw, Settings, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation';
import { ListPage } from '@/components/templates';
import { ListToolbarFrame, ListToolbarRow, ListToolbarEnd } from '@/components/shared/list-toolbar';
import KpiBand from '@/components/shared/kpi-band';
import KpiCard from '@/components/shared/kpi-card';
import Button from '@/components/shared/button';
import { RowMenu } from '@/components/shared/row-actions';
import { FolderDot, FolderDotName, folderDisplayColor } from '@/components/shared/folder-dot';
import { brandInitial } from '@/components/layout/brand-initial';
import EmptyList from '@/components/shared/empty-list';
import ConfirmDialog from '@/components/shared/confirm-dialog';
import FilterChip from '@/components/shared/filter-chip';
import FolderPanel, { FolderPanelNote, type FolderPanelRow } from '@/components/shared/folder-panel';
import ListState from '@/components/shared/list-state';
import Notice from '@/components/shared/notice';
import Pagination from '@/components/shared/pagination';
import SearchField from '@/components/shared/search-field';
import SegmentedControl from '@/components/shared/segmented';
import Select from '@/components/shared/select';
import FolderEditorDialog from '@/components/shared/folder-editor-dialog';
import { describeApiFailure, classifyApiFailure, loadFailureNotice } from '@/components/shared/api-error-message';
import { usePageTitle } from '@/components/shell/page-chrome';
import AccountEditModal from '@/components/accounts/account-edit-modal';
import PlatformNotices from '@/components/hq/platform-notices';
import { api, bookingApi, fetchApi } from '@/lib/api';
import { FOLDER_SELECT_COLORS, type Folder } from '@line-crm/shared';
import { resolveStoreReturnPath } from '@/lib/hq-navigation';
import { formatNumber } from '@/lib/format';
import { useStaffRole, canManageRole } from '@/lib/staff-role';
import { readSessionSnapshot } from '@/lib/session-snapshot';
import { useAccount, type AccountWithStats } from '@/contexts/account-context';
import { AccountArchiveDialogV8, AccountRestoreDialogV8, AccountSettingsDialogV8 } from './account-dialogs';
import { connectionReasonLine } from './connection-reasons';
import styles from './home.module.css';
import { DEFAULT_TAG_FOLDER_COLOR } from '@/v8/tags/public/folder-colors/index'
import StatusBadge from '@/components/shared/status-badge';
import TagPill from '@/components/shared/tag-pill';
import TagOverflow from '@/components/shared/tag-overflow';
import TruncatedText from '@/components/shared/truncated-text';
import { emptyValue } from '@/components/shared/empty-value';
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors';
import { type StatusFilter, type View, UNFILED, ALL, STATUS_FILTERS, SORT_OPTIONS, PAGE_SIZES, isArchived, matchesStatus, statusOf, accountMeta } from "./home-gap-parts"
export default function HqHomeV8() {
  const saveErrors = useSaveFormErrors()
  // 左のメニューと同じ名前を見出しにする（バナー生成・課金プランなどと同じ書き方）。
  usePageTitle('アカウント')
  const router = useRouter()
  const role = useStaffRole()
  /*
   * 運営が「閲覧のみ」で代理ログインしているあいだは、役割がオーナーでも変える口を出さない。
   * サーバも書き込みを断る。決まり：閲覧のみには押せないボタンを置かず隠す（2026-10-06）。
   */
  const readOnlyImpersonation = readSessionSnapshot()?.impersonation?.mode === 'read'
  const canManage = !readOnlyImpersonation && (canManageRole(role))
  const isOwner = !readOnlyImpersonation && role === 'owner'
  const { setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [tenantName, setTenantName] = useState('')
  const [loading, setLoading] = useState(true)
  // M021：捕まえた失敗を持ち、共通部品へ渡す（403 は権限の案内になる）。
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editingAccount, setEditingAccount] = useState<AccountWithStats | null>(null)
  const [settingsAccount, setSettingsAccount] = useState<AccountWithStats | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{ account: AccountWithStats; mode: 'archive' | 'restore' } | null>(null)
  const [checkingConnections, setCheckingConnections] = useState(false)
  const [connectionProgress, setConnectionProgress] = useState('')
  const [connectionResult, setConnectionResult] = useState('')

  const [query, setQuery] = useListUrlValue('q', '')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [folder, setFolder] = useState<string>(ALL)
  const [view, setView] = useListUrlValue<View>('view', 'cards')
  const [sort, setSort] = useListUrlValue('sort', 'friends')
  const [size, setSize] = useState(20)
  const [page, setPage] = useListUrlValue('page', 1)
  const [folders, setFolders] = useState<(Folder & { itemCount?: number })[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  /* フォルダの追加・名前と色を変える窓（同じ窓。editing があれば変える）。 */
  const [folderDialog, setFolderDialog] = useState<{ editing: Folder | null } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState<string | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<Folder | null>(null)
  const [folderError, setFolderError] = useState('')
  const [folderSaving, setFolderSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const accountResponse = await api.lineAccounts.list()
    if (!accountResponse.success) throw new Error(accountResponse.error)
    setAccounts(accountResponse.data as AccountWithStats[])
  }, [])

  const loadFolders = useCallback(async () => {
    try {
      const res = await api.lineAccountFolders.list()
      if (res.success && Array.isArray(res.data?.folders)) {
        setFolders([...res.data.folders].sort((a, b) => a.displayOrder - b.displayOrder))
        setUnfiledCount(typeof res.data.unclassifiedCount === 'number' ? res.data.unclassifiedCount : null)
      }
    } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      // フォルダが読めなくても一覧は出す
    }
  }, [saveErrors])

  useEffect(() => {
    let cancelled = false
    void load()
      .catch((caught: unknown) => { if (!cancelled) setLoadError(caught) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load, reloadKey])

  useEffect(() => {
    void loadFolders()
    let cancelled = false
    void api.tenants.me().then((res) => {
      if (!cancelled && res.success) setTenantName(res.data.name ?? '')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [loadFolders])

  /*
   * WEB215：保存のあとの読み直しが失敗しても、黙って捨てない（保存そのものは済んでいる）。
   * 読み直せなかったことを知らせ、もう一度読み直せるようにする。
   */
  const [reloadFailed, setReloadFailed] = useState(false)
  const reloadAfterSave = async () => {
    setReloadFailed(false)
    try {
      await Promise.all([load(), refreshAccounts(), loadFolders()])
    } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      setReloadFailed(true)
    }
  }

  const refreshConnectionInfo = async () => {
    if (checkingConnections || accounts.length === 0) return
    setCheckingConnections(true)
    setConnectionResult('')
    let succeeded = 0
    let failed = 0
    for (const [index, account] of accounts.entries()) {
      setConnectionProgress(`接続情報を更新中（${index + 1}/${accounts.length}）`)
      const expectedRevision = account.revision
      if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
        failed += 1
        continue
      }
      try {
        await fetchApi(`/api/line-accounts/${encodeURIComponent(account.id)}/connection-checks`, {
          method: 'POST',
          headers: { 'Idempotency-Key': `hq-check-${account.id}-${crypto.randomUUID()}` },
          body: JSON.stringify({ expectedRevision }),
        })
        succeeded += 1
      } catch (saveFailure) {
        saveErrors.capture(saveFailure)
        failed += 1
      }
    }
    try {
      await Promise.all([load(), refreshAccounts()])
      setConnectionResult(failed === 0
        ? `${succeeded} 件のLINE IDと接続状態を更新しました。`
        : `${succeeded} 件を更新し、${failed} 件は更新できませんでした。`)
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)
      if (!fieldFailure) setConnectionResult(`${succeeded} 件を確認しましたが、一覧を再読み込みできませんでした。`)
    } finally {
      setConnectionProgress('')
      setCheckingConnections(false)
    }
  }

  const login = (accountId: string) => {
    setSelectedAccountId(accountId)
    /* 引き継ぎが途中なら続きから動かす。見た目は変えず、答えも待たない（cron でも進む）。 */
    if (canManage) void api.lineAccounts.stepFollowerImport(accountId).catch(() => undefined)
    // 店舗未選択ゲートから来たときは、元いた画面へ戻す（`return` はアプリ内の店舗画面パスだけ：NEXT-07）。
    const back = resolveStoreReturnPath(new URLSearchParams(window.location.search).get('return'))
    router.push(back ?? '/')
  }

  const totals = useMemo(() => accounts.reduce((sum, account) => ({
    friends: sum.friends + (account.stats?.friendCount ?? 0),
    messages: sum.messages + (account.stats?.messagesThisMonth ?? 0),
    warnings: sum.warnings + (!isArchived(account) && account.connection?.status === 'warn' ? 1 : 0),
  }), { friends: 0, messages: 0, warnings: 0 }), [accounts])

  /* 所属は1つ（API-17 の folderId）。サーバーの数が無いときは手元で数える。 */
  const folderOf = useCallback((account: AccountWithStats) => (account as { folderId?: string | null }).folderId ?? null, [])
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of accounts) {
      const id = folderOf(account)
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [accounts, folderOf])
  const localUnfiled = useMemo(() => accounts.filter((account) => !isArchived(account) && !folderOf(account)).length, [accounts, folderOf])

  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase()
    const list = accounts.filter((account) => {
      if (!matchesStatus(account, status)) return false
      if (folder === UNFILED && folderOf(account)) return false
      if (folder !== ALL && folder !== UNFILED && folderOf(account) !== folder) return false
      if (!words) return true
      const hay = [account.name, account.displayName, account.basicId, account.channelId, folders.find((item) => item.id === folderOf(account))?.name]
      return hay.some((text) => text?.toLocaleLowerCase().includes(words))
    })
    return [...list].sort((a, b) =>
      sort === 'name'
        ? (a.displayName || a.name).localeCompare(b.displayName || b.name, 'ja')
        : sort === 'display'
          ? a.displayOrder - b.displayOrder
          : (b.stats?.friendCount ?? 0) - (a.stats?.friendCount ?? 0),
    )
  }, [accounts, status, folder, folderOf, folders, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / size))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * size, current * size)
  /* ★V8 oFq4S：表の「接続」（お支払いのつなぎ：つながっている／試験モード／つなぐ前）。表の行だけ、店ごとに読む。 */
  const [payState, setPayState] = useState<Record<string, 'live' | 'test' | 'none' | 'unknown'>>({})
  const shownIds = shown.map((account) => account.id).join(',')
  useEffect(() => {
    if (view !== 'table' || !shownIds) return
    let alive = true
    void Promise.allSettled(shownIds.split(',').map((id) => bookingApi.getPaymentConfig(id).then((response) => [id, response.data] as const))).then((results) => {
      if (!alive) return
      const next: Record<string, 'live' | 'test' | 'none' | 'unknown'> = {}
      results.forEach((result, index) => {
        const id = shownIds.split(',')[index]
        next[id] = result.status === 'fulfilled' ? (result.value[1].keyConfigured ? (result.value[1].testMode ? 'test' : 'live') : 'none') : 'unknown'
      })
      setPayState((current) => ({ ...current, ...next }))
    })
    return () => { alive = false }
  }, [view, shownIds])
  const resetPage = () => setPage(1)
  const statusCount = (filter: StatusFilter) => accounts.filter((account) => matchesStatus(account, filter)).length
  const nameOf = (id: string | null | undefined) => {
    if (!id) return null
    const found = accounts.find((account) => account.id === id)
    return found ? (found.displayName || found.name) : null
  }

  const openFolderDialog = (editing: Folder | null) => {
    setFolderName(editing?.name ?? '')
    setFolderColor(editing ? folderDisplayColor(editing) : DEFAULT_TAG_FOLDER_COLOR)
    setFolderError('')
    setFolderDialog({ editing })
  }

  /* フォルダを足す／名前と色を変える（API-17：POST・PATCH /api/line-account-folders）。 */
  const saveFolder = async () => {
    const name = folderName.trim()
    if (!name || folderSaving || !folderDialog) return
    setFolderSaving(true)
    setFolderError('')
    try {
      const color = folderColor
      const res = folderDialog.editing
        ? await api.lineAccountFolders.update(folderDialog.editing.id, { name, color })
        : await api.lineAccountFolders.create({ name, color })
      if (!res.success) throw new Error(res.error)
      setFolderDialog(null)
      await loadFolders()
      void reloadAfterSave()
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)

      { if (!fieldFailure)
      setFolderError(describeApiFailure(caught, '保存', { scope: 'hq' })) }
    } finally {
      setFolderSaving(false)
    }
  }

  /* 並べ替える：隣と表示順を入れ替える。 */
  const moveFolder = async (index: number, delta: -1 | 1) => {
    const a = folders[index]
    const b = folders[index + delta]
    if (!a || !b || folderSaving) return
    setFolderSaving(true)
    try {
      await api.lineAccountFolders.update(a.id, { displayOrder: b.displayOrder === a.displayOrder ? index + delta : b.displayOrder })
      await api.lineAccountFolders.update(b.id, { displayOrder: b.displayOrder === a.displayOrder ? index : a.displayOrder })
    } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      // 並びが変わらなかったときは読み直した結果を見せる
    } finally {
      setFolderSaving(false)
      await loadFolders()
    }
  }

  /* 消す：中のアカウントは消えず未分類へ（API-17 の DELETE）。 */
  const removeFolder = async (target: Folder) => {

    setFolderSaving(true)
    setFolderError('')
    try {
      const response = await api.lineAccountFolders.remove(target.id)
      if (!response.success) throw new Error(response.error)
      setDeleteFolder(null)
      if (folder === target.id) setFolder(ALL)
      await loadFolders()
      void reloadAfterSave()
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)

      { if (!fieldFailure)
      setFolderError(describeApiFailure(caught, '保存', { scope: 'hq' })) }
    } finally {
      setFolderSaving(false)
    }
  }

  const folderRows: FolderPanelRow[] = [
    { kind: 'all' as const, id: ALL, label: 'すべて', count: accounts.length, icon: <Inbox size={15} aria-hidden="true" /> },
    ...folders.map((f, index) => ({
      kind: 'folder' as const,
      id: f.id,
      label: f.name,
      count: typeof f.itemCount === 'number' ? f.itemCount : (folderCounts.get(f.id) ?? 0),
      color: f.color,
      icon: <FolderDot folder={{ name: f.name, color: f.color }} />,
      onEdit: canManage ? () => openFolderDialog(f) : undefined,
      onMoveUp: canManage && index > 0 ? () => void moveFolder(index, -1) : undefined,
      onMoveDown: canManage && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
      onDelete: canManage ? () => { setFolderError(''); setDeleteFolder(f) } : undefined,
    })),
    { kind: 'unfiled' as const, id: UNFILED, label: '未分類', count: unfiledCount ?? localUnfiled },
  ]

  const createAccount = canManage ? (
    <Button href="/accounts/new" variant="primary">
      <Plus aria-hidden="true" className={styles.buttonIcon} />アカウントを登録
    </Button>
  ) : null
  const selectFolder = (id: string) => { setFolder(id); resetPage() }
  const folderColumn = (
    <div className={styles.folderBox}>
      <FolderPanel
        reserveCreateSpace={canManage}
        createAction={createAccount}
        heading="フォルダ"
        rows={folderRows}
        activeId={folder}
        onSelect={selectFolder}
        onAddFolder={canManage ? () => openFolderDialog(null) : undefined}
        addFolderLabel="フォルダを追加"
      >
        <FolderPanelNote>フォルダを消しても、アカウントは消えません</FolderPanelNote>
      </FolderPanel>
    </div>
  )

  const cardActions = (account: AccountWithStats) => {
    if (isArchived(account)) {
      return (
        <div className={styles.cardButtons}>
          <Button className={styles.grow} onClick={() => setEditingAccount(account)}>
            {/* 絵 JKjsE：「詳細」の印は log-in。 */}
            <LogIn aria-hidden="true" className={styles.buttonIcon} />詳細
          </Button>
          {isOwner ? (
            <Button onClick={() => setArchiveTarget({ account, mode: 'restore' })}>
              <RotateCcw aria-hidden="true" className={styles.buttonIcon} />戻す
            </Button>
          ) : null}
        </div>
      )
    }
    return (
      <div className={styles.cardButtons}>
        <Button className={styles.grow} onClick={() => login(account.id)} aria-label={`${account.displayName || account.name} へ入る`}>
          <LogIn aria-hidden="true" className={styles.buttonIcon} />入る
        </Button>
        {canManage ? (
          <Button onClick={() => setSettingsAccount(account)} aria-label={`${account.displayName || account.name} の設定`}>
            <Settings aria-hidden="true" className={styles.buttonIcon} />設定
          </Button>
        ) : null}
      </div>
    )
  }

  /* ★V8 oFq4S：表の行末は「…」1つ（行の操作は中に）。 */
  const tableMenu = (account: AccountWithStats) => {
    const name = account.displayName || account.name
    const items = isArchived(account)
      ? [
          { id: 'detail', label: '詳細', onSelect: () => setEditingAccount(account) },
          ...(isOwner ? [{ id: 'restore', label: '戻す', onSelect: () => setArchiveTarget({ account, mode: 'restore' as const }) }] : []),
        ]
      : [
          ...(isOwner ? [{ id: 'billing', label: 'お支払いの設定を開く', onSelect: () => router.push('/hq/billing') }] : []),
          { id: 'login', label: 'このアカウントに切り替える', onSelect: () => login(account.id) },
          ...(canManage ? [{ id: 'settings', label: '設定', onSelect: () => setSettingsAccount(account) }] : []),
        ]
    return <RowMenu label={`${name}の操作`} items={items} />
  }

  const folderDotOf = (account: AccountWithStats) => {
    const id = folderOf(account)
    const found = id ? folders.find((item) => item.id === id) ?? (account as { folder?: Folder | null }).folder ?? null : null
    return found ? { name: found.name, color: found.color } : null
  }


  const toolbar = loadError || loading || accounts.length === 0 ? null : <>
      <PlatformNotices />
      <KpiBand className={styles.full} data-design="KPIs">
        <KpiCard title="アカウント" value={accounts.length} unit="件" detail={null} />
        <KpiCard title="友だち合計" value={totals.friends} unit="人" detail={null} help="全アカウントの合計" />
        <KpiCard title="今月の配信" value={totals.messages} unit="通" detail={null} />
        <KpiCard title="接続に問題" value={totals.warnings} unit="件" detail={null} valueTone="warning" />
      </KpiBand>

      <ListToolbarFrame layout="stacked">
        <ListToolbarRow><div className={styles.searchBox}>
          <SearchField
            aria-label="名前・LINE ID・フォルダで探す"
            placeholder="名前・LINE ID・フォルダで探す"
            value={query}
            onChange={(value) => { setQuery(value); resetPage() }}
            onClear={() => { setQuery(''); resetPage() }}
          />
        </div></ListToolbarRow>
        <ListToolbarRow>
          <div role="group" aria-label="状態で絞り込む" className={styles.chips}>
            {STATUS_FILTERS.map((item) => (
              <FilterChip key={item.value} selected={status === item.value} icon={item.icon} onChange={() => { setStatus(item.value); resetPage() }}>
                {`${item.label} ${statusCount(item.value)}`}
              </FilterChip>
            ))}
          </div>
          <ListToolbarEnd>
          <SaveErrorField names={["view"]}><SegmentedControl<View>
            aria-label="表示の切り替え"
            value={view}
            onChange={setView}
            options={[{ value: 'cards', label: <LayoutGrid className={styles.buttonIcon} aria-hidden="true" />, ariaLabel: 'カード' }, { value: 'table', label: <List className={styles.buttonIcon} aria-hidden="true" />, ariaLabel: '表' }]}
          /></SaveErrorField>
          <SaveErrorField names={["sort"]}><Select label="並び" aria-label="アカウントの並び順" value={sort} size="content" onChange={(value) => { setSort(value); resetPage() }} options={SORT_OPTIONS} /></SaveErrorField>
          <SaveErrorField names={["size"]}><Select
            aria-label="アカウントの表示件数"
            value={String(size)}
            width={110}
            onChange={(value) => { setSize(Number(value)); resetPage() }}
            options={PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} 件表示` }))}
          /></SaveErrorField>
          </ListToolbarEnd>
        </ListToolbarRow>
      </ListToolbarFrame>
  </>

  const body = loadError ? (
    <Notice
      tone="danger"
      message={loadFailureNotice(loadError, '統括のアカウント情報', 'hq')}
      action={classifyApiFailure(loadError) === 'forbidden' ? undefined : (
        <Button type="button" onClick={() => { setLoading(true); setReloadKey((key) => key + 1) }}>もう一度読み込む</Button>
      )}
    />
  ) : loading ? (
    <ListState permissionScope="hq" kind="loading" loadingShape={view === 'cards' ? 'cards' : 'list'} title="アカウントを読み込んでいます" />
  ) : accounts.length === 0 ? (
    <EmptyList
      icon={<MessageCircle aria-hidden="true" />}
      title="まだ LINE 公式アカウントがありません"
      description="アカウントを登録すると、ここから各アカウントの管理画面に入れます。"
      create={{ label: '最初のアカウントを登録する', href: '/accounts/new' }}
      canCreate={canManage}
    />
  ) : (
    <>
      {connectionProgress ? <p className={styles.progress} role="status">{connectionProgress}</p> : null}
      {connectionResult ? <Notice tone="info" message={connectionResult} /> : null}
      {reloadFailed ? (
        <Notice
          tone="warn"
          message="保存はできましたが、一覧を読み直せませんでした。"
          action={<Button type="button" onClick={() => reloadAfterSave()} busyLabel="処理中…">もう一度読み込む</Button>}
        />
      ) : null}

      {shown.length === 0 ? (
        <EmptyList
          icon={<MessageCircle aria-hidden="true" />}
          title="まだ LINE 公式アカウントがありません"
          description=""
          filtered
          onClearFilters={() => { setQuery(''); setStatus(STATUS_FILTERS[0].value); setFolder(ALL); resetPage() }}
          filteredDescription="検索の言葉や絞り込みを外すと、すべて出ます"
        />
      ) : view === 'cards' ? (
        <div className={styles.grid}>
          {shown.map((account) => {
            const state = statusOf(account)
            const warned = state.tone === 'warn'
            const name = account.displayName || account.name
            return (
              <article key={account.id} className={styles.card} aria-label={name}>
                <div className={styles.cardHead}>
                  <span className={styles.logo} aria-hidden="true">{brandInitial(tenantName || name)}</span>
                  <div className={styles.cardName}>
                    {/* 絵 `JKjsE`：名前の前に左の列（フォルダ）の色の丸。未分類は色の無い輪。 */}
                    <p className={styles.name} title={name}>
                      <FolderDotName folder={folderDotOf(account)}>{name}</FolderDotName>
                    </p>
                    {/* B-31：名前の下は1行で省略し、全文は title。 */}
                    <TruncatedText className={styles.meta} value={accountMeta(account, nameOf((account as { parentLineAccountId?: string | null }).parentLineAccountId))} />
                  </div>
                  <StatusBadge tone={state.tone === 'ok' ? 'success' : state.tone === 'warn' ? 'warning' : 'neutral'}>{state.label}</StatusBadge>
                </div>
                <TagOverflow label={`${name}の分類`}>
                  {folderDotOf(account) ? <TagPill name={folderDotOf(account)!.name} color={folderDotOf(account)!.color} aria-label={`フォルダ：${folderDotOf(account)!.name}`} /> : null}
                  {(account.tags ?? []).map(tag => <TagPill key={tag.id} name={tag.name} color={tag.color} />)}
                </TagOverflow>
                <dl className={styles.stats}>
                  <div className={styles.stat}>
                    <dt>友だち</dt>
                    <dd>{isArchived(account) && !account.stats?.friendCount ? emptyValue('unknown') : formatNumber(account.stats?.friendCount ?? 0)}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>今月の配信</dt>
                    <dd>{`${formatNumber(account.stats?.messagesThisMonth ?? 0)} 通`}</dd>
                  </div>
                </dl>
                <div className={styles.reasonSlot}>
                  {warned ? (() => {
                    const reason = connectionReasonLine(account)
                    return <Notice tone="warn" compact title={reason.title} message={reason.text}
                      action={canManage ? <button type="button" onClick={() => void refreshConnectionInfo()} disabled={checkingConnections} className={styles.linkButton}>更新する</button> : undefined}
                    />
                  })() : null}
                </div>
                {cardActions(account)}
              </article>
            )
          })}
        </div>
      ) : (
        <DataTable aria-label="アカウントの一覧">
          <thead><TableHeadRow>
            <Th>アカウント</Th>
            <Th>接続</Th>
            <Th>対応が要る</Th>
            <Th>友だち</Th>
            <Th>今月の配信</Th>
            <Th className="sr-only">操作</Th>
          </TableHeadRow></thead><tbody>
          {shown.map((account) => {
            const state = statusOf(account)
            const name = account.displayName || account.name
            return (
              <Tr key={account.id}>
                <PersonCell avatarName={brandInitial(tenantName || name)} avatarSize={32} name={
                  <span className={styles.cardName}>
                    <FolderDotName folder={folderDotOf(account)} annotation={<StatusBadge tone={state.tone === 'ok' ? 'success' : state.tone === 'warn' ? 'warning' : 'neutral'}>{state.label}</StatusBadge>}>
                      <TruncatedText className={styles.name} value={String(name ?? '')} />
                    </FolderDotName>
                    <TruncatedText className={styles.meta} value={accountMeta(account, nameOf((account as { parentLineAccountId?: string | null }).parentLineAccountId))} />
                  </span>
                } />
                <Td>{(() => {
                  const pay = payState[account.id]
                  if (!pay || pay === 'unknown') return emptyValue('unknown')
                  return <StatusBadge tone={pay === 'live' ? 'success' : pay === 'test' ? 'warning' : 'neutral'}>{pay === 'live' ? 'つながっている' : pay === 'test' ? '試験モード' : 'つなぐ前'}</StatusBadge>
                })()}</Td>
                <Td>{state.tone === 'warn' ? `${Math.max(1, account.connection?.issues?.length ?? 0)} 件` : <span>—</span>}</Td>
                <Td>{formatNumber(account.stats?.friendCount ?? 0)}</Td>
                <Td>{formatNumber(account.stats?.messagesThisMonth ?? 0)}</Td>
                <Td>{tableMenu(account)}</Td>
              </Tr>
            )
          })}
        </tbody></DataTable>
      )}

      <div className={styles.footer}>
        <span className={styles.range}>
          {filtered.length === 0 ? '0件' : `${formatNumber(filtered.length)} 件中 ${formatNumber((current - 1) * size + 1)}〜${formatNumber((current - 1) * size + shown.length)} 件`}
        </span>
        <p className={styles.footNote}>カードの「設定」から、フォルダの移動・名前・親アカウントを変えられます</p>
        {pageCount > 1 ? <Pagination page={current} pageCount={pageCount} onPageChange={setPage} ariaLabel="アカウントのページ送り" /> : null}
      </div>
    </>
  )

  return (
    <SaveErrorScope errors={saveErrors}><ListPage
      boardId="JKjsE"
      title="統括のアカウント"
      help={<>{`${tenantName || 'この統括'}に属する LINE 公式アカウントです。ここから各アカウントへ入れます。`}{"カードの「設定」から、フォルダの移動・名前・親アカウントを変えられます。アーカイブしたアカウントは「詳細」と「戻す」だけです（戻すのはオーナー・本人確認のあと「停止中」に戻ります）。"}</>}

      folders={folderColumn}
      folderInset toolbar={toolbar} toolbarSpacing="section" toolbarRowGap="card"
      folderWidth={200}
      folderNav={{ rows: folderRows, activeId: folder, onSelect: selectFolder, createAction: createAccount, label: 'フォルダ' }}
    >
      <div className={styles.body}>
        {toolbar ? null : <PlatformNotices />}
        {body}
      </div>

      {settingsAccount ? (
        <AccountSettingsDialogV8
          account={settingsAccount}
          accounts={accounts}
          archived={isArchived(settingsAccount)}
          onClose={() => setSettingsAccount(null)}
          onSaved={() => { setSettingsAccount(null); void reloadAfterSave() }}
          onArchive={() => {
            setArchiveTarget({ account: settingsAccount, mode: isArchived(settingsAccount) ? 'restore' : 'archive' })
            setSettingsAccount(null)
          }}
          onShowDetails={() => { setEditingAccount(settingsAccount); setSettingsAccount(null) }}
          canCreateFolder={canManage}
          onFolderCreated={() => void loadFolders()}
        />
      ) : null}
      {archiveTarget?.mode === 'archive' ? (
        <AccountArchiveDialogV8 account={archiveTarget.account} onClose={() => setArchiveTarget(null)} onDone={() => { setArchiveTarget(null); void reloadAfterSave() }} />
      ) : null}
      {archiveTarget?.mode === 'restore' ? (
        <AccountRestoreDialogV8 account={archiveTarget.account} onClose={() => setArchiveTarget(null)} onDone={() => { setArchiveTarget(null); void reloadAfterSave() }} />
      ) : null}
      {editingAccount ? (
        <AccountEditModal
          accountId={editingAccount.id}
          initialName={editingAccount.name}
          initialChannelId={editingAccount.channelId}
          initialLoginChannelId={editingAccount.loginChannelId ?? null}
          initialLiffId={editingAccount.liffId ?? null}
          initialOgSiteName={editingAccount.ogSiteName ?? null}
          initialOgDefaultDescription={editingAccount.ogDefaultDescription ?? null}
          initialOgDefaultImageUrl={editingAccount.ogDefaultImageUrl ?? null}
          initialFriendCapacity={editingAccount.friendCapacity ?? null}
          initialCapacityWarnAt={editingAccount.capacityWarnAt ?? null}
          initialIconUrl={editingAccount.iconUrl ?? null}
          onClose={() => setEditingAccount(null)}
          onSaved={() => { void reloadAfterSave() }}
        />
      ) : null}

      <FolderEditorDialog
        open={folderDialog !== null}
        title={folderDialog?.editing ? 'フォルダの名前と色を変える' : 'フォルダを追加'}
        description="アカウントは1つのフォルダに入ります。フォルダを消しても、アカウントは消えません。"
        name={folderName} onNameChange={setFolderName} nameId="hq-account-folder-name" nameLabel="フォルダの名前"
        color={folderColor} onColorChange={setFolderColor} colors={FOLDER_SELECT_COLORS}
        placeholder="例：渋谷エリア" maxLength={100}
        onCancel={() => { if (!folderSaving) setFolderDialog(null) }}
        designNode="JKjsE" busy={folderSaving} error={folderError || undefined}
        confirmLabel={folderDialog?.editing ? '保存する' : '追加する'} cancelLabel="やめる"
        onConfirm={() => saveFolder()}
      />

      {deleteFolder ? (
        <ConfirmDialog
          open
          title={`フォルダ「${deleteFolder.name}」を消しますか？`}
          description={`中のアカウント ${formatNumber(folderCounts.get(deleteFolder.id) ?? 0)} 件は消えずに「未分類」へ移ります。消したフォルダは元に戻せません。`}
          confirmLabel="フォルダを消す"
          cancelLabel="キャンセル"
          destructive
          busy={folderSaving}
          error={folderError || undefined}
          onConfirm={() => removeFolder(deleteFolder)}
          onCancel={() => { if (!folderSaving) setDeleteFolder(null) }}
        />
      ) : null}
    </ListPage></SaveErrorScope>
  )
}
