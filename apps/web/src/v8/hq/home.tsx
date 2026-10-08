'use client'

/*
 * ★V8 統括のアカウント（ホーム）（Pencil `JKjsE`。カードの「設定」で開く窓が `HMpVx`）。
 *
 * v7 の画面（app/hq/page.tsx と account-browser-v8.tsx）と読み書きの口・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左のフォルダの列（型のフォルダの列＋共通 FolderPanel。2026-10-08 タグ→フォルダ・API-17）・
 * 数のカード4枚・探す欄と状態の札・カード／表の切り替え・並び・件数・アカウントのカード・件数と注。
 */
import { CircleDot, Inbox, LogIn, Plus, RotateCcw, Settings, Star, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import { FolderDotName } from '@/components/shared/folder-dot'
import { brandInitial } from '@/components/layout/brand-initial'
import EmptyList from '@/components/shared/empty-list'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { classifyApiFailure, loadFailureNotice } from '@/components/shared/api-error-message'
import { usePageTitle } from '@/components/shell/page-chrome'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import PlatformNotices from '@/components/hq/platform-notices'
import { api, fetchApi } from '@/lib/api'
import type { Folder } from '@line-crm/shared'
import { resolveStoreReturnPath } from '@/lib/hq-navigation'
import { formatNumber } from '@/lib/format'
import { useStaffRole } from '@/lib/staff-role'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import { AccountArchiveDialogV8, AccountRestoreDialogV8, AccountSettingsDialogV8, accountHandle } from './account-dialogs'
import { connectionReasonLine } from './connection-reasons'
import styles from './home.module.css'

type StatusFilter = 'all' | 'ok' | 'warn' | 'archived'
type View = 'cards' | 'table'

/** 「未分類」を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__none__'
const ALL = '__all__'

const STATUS_FILTERS: { value: StatusFilter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'すべて', icon: <CircleDot size={14} aria-hidden="true" /> },
  { value: 'ok', label: '正常', icon: <Star size={14} aria-hidden="true" /> },
  { value: 'warn', label: '要確認', icon: <Star size={14} aria-hidden="true" /> },
  { value: 'archived', label: 'アーカイブ', icon: <Star size={14} aria-hidden="true" /> },
]

const SORT_OPTIONS = [
  { value: 'friends', label: '並び：友だち順' },
  { value: 'name', label: '並び：名前順' },
  { value: 'display', label: '並び：登録順' },
]

const PAGE_SIZES = [10, 20, 50]

/** フォルダの色（追加・色を変える窓で選ぶ）。値はテーマの色の名前。 */
const FOLDER_COLORS = [
  { value: '', label: 'なし' },
  { value: '--color-status-info', label: '青' },
  { value: '--color-accent-deep', label: '緑' },
  { value: '--color-status-warn-deep', label: '橙' },
  { value: '--color-status-danger', label: '赤' },
  { value: '--color-chip-alt', label: '紫' },
]

function isArchived(account: AccountWithStats) {
  return Boolean(account.archivedAt)
}

function matchesStatus(account: AccountWithStats, filter: StatusFilter) {
  if (filter === 'all') return true
  if (filter === 'archived') return isArchived(account)
  if (isArchived(account)) return false
  if (filter === 'ok') return account.isActive && account.connection?.status === 'ok'
  return account.isActive && account.connection?.status !== 'ok'
}

function statusOf(account: AccountWithStats): { label: string; tone: 'ok' | 'warn' | 'idle' } {
  if (isArchived(account)) return { label: 'アーカイブ', tone: 'idle' }
  if (!account.isActive) return { label: '停止中', tone: 'idle' }
  if (account.connection?.status === 'ok') return { label: '正常', tone: 'ok' }
  if (account.connection?.status === 'warn') return { label: '要確認', tone: 'warn' }
  return { label: '未確認', tone: 'idle' }
}

export default function HqHomeV8() {
  // 左のメニューと同じ名前を見出しにする（バナー生成・課金プランなどと同じ書き方）。
  usePageTitle('アカウント')
  const router = useRouter()
  const role = useStaffRole()
  /*
   * 運営が「閲覧のみ」で代理ログインしているあいだ（絵 VtJQ6）は、役割がオーナーでも変える口を出さない。
   * サーバも書き込みを断る。決まり：閲覧のみには押せないボタンを置かず隠す（2026-10-06）。
   */
  const readOnlyImpersonation = readSessionSnapshot()?.impersonation?.mode === 'read'
  const canManage = !readOnlyImpersonation && (role === 'owner' || role === 'admin')
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

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [folder, setFolder] = useState<string>(ALL)
  const [view, setView] = useState<View>('cards')
  const [sort, setSort] = useState('friends')
  const [size, setSize] = useState(20)
  const [page, setPage] = useState(1)
  const [folders, setFolders] = useState<(Folder & { itemCount?: number })[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  /* フォルダの追加・名前と色を変える窓（同じ窓。editing があれば変える）。 */
  const [folderDialog, setFolderDialog] = useState<{ editing: Folder | null } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState('')
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
    } catch {
      // フォルダが読めなくても一覧は出す
    }
  }, [])

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

  const reloadAfterSave = async () => {
    await Promise.all([load(), refreshAccounts(), loadFolders()])
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
      } catch {
        failed += 1
      }
    }
    try {
      await Promise.all([load(), refreshAccounts()])
      setConnectionResult(failed === 0
        ? `${succeeded}件のLINE IDと接続状態を更新しました。`
        : `${succeeded}件を更新し、${failed}件は更新できませんでした。`)
    } catch {
      setConnectionResult(`${succeeded}件を確認しましたが、一覧を再読み込みできませんでした。`)
    } finally {
      setConnectionProgress('')
      setCheckingConnections(false)
    }
  }

  const login = (accountId: string) => {
    setSelectedAccountId(accountId)
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
  const resetPage = () => setPage(1)
  const statusCount = (filter: StatusFilter) => accounts.filter((account) => matchesStatus(account, filter)).length
  const nameOf = (id: string | null | undefined) => {
    if (!id) return null
    const found = accounts.find((account) => account.id === id)
    return found ? (found.displayName || found.name) : null
  }

  const colorValue = (token: string) => (token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() || null : null)

  const openFolderDialog = (editing: Folder | null) => {
    setFolderName(editing?.name ?? '')
    setFolderColor(editing ? (FOLDER_COLORS.find((item) => item.value && colorValue(item.value)?.toLowerCase() === editing.color?.toLowerCase())?.value ?? '') : '')
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
      const color = colorValue(folderColor)
      const res = folderDialog.editing
        ? await api.lineAccountFolders.update(folderDialog.editing.id, { name, color })
        : await api.lineAccountFolders.create({ name, color })
      if (!res.success) throw new Error(res.error)
      setFolderDialog(null)
      await loadFolders()
      void reloadAfterSave()
    } catch (caught) {
      setFolderError(caught instanceof Error ? caught.message : 'フォルダを保存できませんでした')
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
    } catch {
      // 並びが変わらなかったときは読み直した結果を見せる
    } finally {
      setFolderSaving(false)
      await loadFolders()
    }
  }

  /* 消す：中のアカウントは消えず未分類へ（API-17 の DELETE）。 */
  const removeFolder = async (target: Folder) => {
    if (folderSaving) return
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
      setFolderError(caught instanceof Error ? caught.message : 'フォルダを消せませんでした')
    } finally {
      setFolderSaving(false)
    }
  }

  const folderRows: FolderPanelRow[] = [
    { id: ALL, label: 'すべて', count: accounts.length, icon: <Inbox size={15} aria-hidden="true" /> },
    ...folders.map((f, index) => ({
      id: f.id,
      label: f.name,
      count: typeof f.itemCount === 'number' ? f.itemCount : (folderCounts.get(f.id) ?? 0),
      color: f.color,
      onEdit: canManage ? () => openFolderDialog(f) : undefined,
      onMoveUp: canManage && index > 0 ? () => void moveFolder(index, -1) : undefined,
      onMoveDown: canManage && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
      onDelete: canManage ? () => { setFolderError(''); setDeleteFolder(f) } : undefined,
    })),
    { id: UNFILED, label: '未分類', count: unfiledCount ?? localUnfiled },
  ]

  const createAccount = canManage ? (
    <Button href="/accounts/new" variant="primary" className={styles.createButton}>
      <Plus aria-hidden="true" className={styles.buttonIcon} />アカウントを登録
    </Button>
  ) : null
  const selectFolder = (id: string) => { setFolder(id); resetPage() }
  const folderColumn = (
    <div className={styles.folderBox}>
      <FolderPanel
        /* 閲覧のみで登録ボタンを隠したときも、その場所は空けておく（下のフォルダの列が上へ詰まらない。絵 VtJQ6）。 */
        createAction={createAccount ?? <span className={styles.createSpace} aria-hidden="true" />}
        heading="フォルダ"
        rows={folderRows}
        activeId={folder}
        onSelect={selectFolder}
        onAddFolder={canManage ? () => openFolderDialog(null) : undefined}
        addFolderLabel="フォルダを追加"
      >
        <p className={styles.folderNote}>フォルダを消しても、アカウントは消えません</p>
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
        <Button className={styles.grow} onClick={() => login(account.id)}>
          <LogIn aria-hidden="true" className={styles.buttonIcon} />このアカウントへ入る
        </Button>
        {canManage ? (
          <Button onClick={() => setSettingsAccount(account)} aria-label={`${account.displayName || account.name} の設定`}>
            <Settings aria-hidden="true" className={styles.buttonIcon} />設定
          </Button>
        ) : null}
      </div>
    )
  }

  const folderDotOf = (account: AccountWithStats) => {
    const id = folderOf(account)
    const found = id ? folders.find((item) => item.id === id) ?? (account as { folder?: Folder | null }).folder ?? null : null
    return found ? { name: found.name, color: found.color } : null
  }

  const metaOf = (account: AccountWithStats) => {
    const parent = nameOf((account as { parentLineAccountId?: string | null }).parentLineAccountId)
    return [accountHandle(account), parent ? `親：${parent}` : null, `権限者 ${formatNumber(account.stats?.staffCount ?? 0)} 人`].filter(Boolean).join(' ・ ')
  }

  const body = loadError ? (
    <Notice
      tone="danger"
      message={loadFailureNotice(loadError, '統括のアカウント情報')}
      action={classifyApiFailure(loadError) === 'forbidden' ? undefined : (
        <Button type="button" onClick={() => { setLoading(true); setReloadKey((key) => key + 1) }}>再読み込み</Button>
      )}
    />
  ) : loading ? (
    <ListState kind="loading" title="アカウントを読み込んでいます" />
  ) : accounts.length === 0 ? (
    /* 修正案 D-2：空の一覧。 */
    <EmptyList
      icon={<MessageCircle aria-hidden="true" />}
      title="まだ LINE 公式アカウントがありません"
      description="アカウントを登録すると、ここから各アカウントの管理画面に入れます。"
      create={{ label: '最初のアカウントを登録する', href: '/accounts/new' }}
      canCreate={canManage}
    />
  ) : (
    <>
      <div className={styles.cards} data-design="KPIs">
        <StatCard label="アカウント" value={formatNumber(accounts.length)} unit="件" />
        <StatCard label="友だち合計" value={formatNumber(totals.friends)} unit="人" title="全アカウントの合計" />
        <StatCard label="今月の配信" value={formatNumber(totals.messages)} unit="通" />
        <StatCard label="接続に問題" value={formatNumber(totals.warnings)} unit="件" warn />
      </div>

      <div className={styles.tools}>
        <div className={styles.searchBox}>
          <SearchField
            aria-label="名前・LINE ID・フォルダで探す"
            placeholder="名前・LINE ID・フォルダで探す"
            value={query}
            onChange={(value) => { setQuery(value); resetPage() }}
            onClear={() => { setQuery(''); resetPage() }}
          />
        </div>
        <div className={styles.toolRow}>
          <div role="group" aria-label="状態で絞り込む" className={styles.chips}>
            {STATUS_FILTERS.map((item) => (
              <FilterChip key={item.value} selected={status === item.value} icon={item.icon} onChange={() => { setStatus(item.value); resetPage() }}>
                {`${item.label} ${statusCount(item.value)}`}
              </FilterChip>
            ))}
          </div>
          <span className={styles.spacer} />
          <SegmentedControl<View>
            aria-label="表示の切り替え"
            value={view}
            onChange={setView}
            options={[{ value: 'cards', label: 'カード' }, { value: 'table', label: '表' }]}
          />
          <Select aria-label="アカウントの並び順" value={sort} width={134} onChange={(value) => { setSort(value); resetPage() }} options={SORT_OPTIONS} />
          <Select
            aria-label="アカウントの表示件数"
            value={String(size)}
            width={110}
            onChange={(value) => { setSize(Number(value)); resetPage() }}
            options={PAGE_SIZES.map((value) => ({ value: String(value), label: `${value}件表示` }))}
          />
        </div>
      </div>

      {connectionProgress ? <p className={styles.progress} role="status">{connectionProgress}</p> : null}
      {connectionResult ? <Notice tone="info" message={connectionResult} /> : null}

      {shown.length === 0 ? (
        <EmptyList
          icon={<MessageCircle aria-hidden="true" />}
          title="まだ LINE 公式アカウントがありません"
          description=""
          filtered
          onClearFilters={() => { setQuery(''); setStatus(STATUS_FILTERS[0].value); resetPage() }}
          filteredDescription="検索の言葉や絞り込みを外すと、すべて出ます"
        />
      ) : view === 'cards' ? (
        <div className={styles.grid}>
          {shown.map((account) => {
            const state = statusOf(account)
            const warned = state.tone === 'warn'
            const name = account.displayName || account.name
            return (
              <article key={account.id} className={warned ? `${styles.card} ${styles.cardWarn}` : styles.card} aria-label={name}>
                <div className={styles.cardHead}>
                  <span className={styles.logo} aria-hidden="true">{brandInitial(tenantName || name)}</span>
                  <div className={styles.cardName}>
                    {/* 絵 `JKjsE`：名前の前に左の列（フォルダ）の色の丸。未分類は色の無い輪。 */}
                    <p className={styles.name} title={name}>
                      <FolderDotName folder={folderDotOf(account)}>{name}</FolderDotName>
                    </p>
                    {/* B-31：名前の下は1行で省略し、全文は title。 */}
                    <p className={styles.meta} title={metaOf(account)}>{metaOf(account)}</p>
                  </div>
                  <span className={state.tone === 'ok' ? `${styles.pill} ${styles.pill_ok}` : state.tone === 'warn' ? `${styles.pill} ${styles.pill_warn}` : `${styles.pill} ${styles.pill_idle}`}><span className={styles.dot} aria-hidden="true" />{state.label}</span>
                </div>
                <dl className={styles.stats}>
                  <div className={styles.stat}>
                    <dt>友だち</dt>
                    <dd>{isArchived(account) && !account.stats?.friendCount ? '—' : formatNumber(account.stats?.friendCount ?? 0)}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>今月の配信</dt>
                    <dd>{`${formatNumber(account.stats?.messagesThisMonth ?? 0)} 通`}</dd>
                  </div>
                </dl>
                {cardActions(account)}
                {warned ? (() => {
                  /* 要確認の理由を、引っかかった確認ごとの言葉で1行に。長ければ省略し title で全文。 */
                  const reason = connectionReasonLine(account)
                  return (
                    <p className={styles.warnLine}>
                      <span className={styles.warnText} title={reason.title}>{reason.text}</span>
                      {canManage ? (
                        <button type="button" onClick={() => void refreshConnectionInfo()} disabled={checkingConnections} className={styles.linkButton}>更新する</button>
                      ) : null}
                    </p>
                  )
                })() : null}
              </article>
            )
          })}
        </div>
      ) : (
        <div className={styles.table} role="table" aria-label="アカウントの一覧">
          <div className={styles.head} role="row">
            <span role="columnheader">アカウント</span>
            <span role="columnheader">状態</span>
            <span role="columnheader" className={styles.num}>友だち</span>
            <span role="columnheader" className={styles.num}>今月の配信</span>
            <span role="columnheader">操作</span>
          </div>
          {shown.map((account) => {
            const state = statusOf(account)
            const name = account.displayName || account.name
            return (
              <div key={account.id} className={styles.row} role="row">
                <span role="cell" className={styles.rowName}>
                  <span className={styles.logo} aria-hidden="true">{brandInitial(tenantName || name)}</span>
                  <span className={styles.cardName}>
                    <span className={styles.name} title={name}>{name}</span>
                    <span className={styles.meta}>{metaOf(account)}</span>
                  </span>
                </span>
                <span role="cell"><span className={state.tone === 'ok' ? `${styles.pill} ${styles.pill_ok}` : state.tone === 'warn' ? `${styles.pill} ${styles.pill_warn}` : `${styles.pill} ${styles.pill_idle}`}><span className={styles.dot} aria-hidden="true" />{state.label}</span></span>
                <span role="cell" className={styles.num}>{formatNumber(account.stats?.friendCount ?? 0)}</span>
                <span role="cell" className={styles.num}>{formatNumber(account.stats?.messagesThisMonth ?? 0)}</span>
                <span role="cell">{cardActions(account)}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.range}>
          {filtered.length === 0 ? '0件' : `${formatNumber(filtered.length)}件中 ${formatNumber((current - 1) * size + 1)}〜${formatNumber((current - 1) * size + shown.length)}件`}
        </span>
        <p className={styles.footNote}>カードの「設定」から、フォルダの移動・名前・親アカウントを変えられます。アーカイブしたアカウントは「詳細」と「戻す」だけです（戻すのはオーナー・本人確認のあと「停止中」に戻ります）。</p>
        {pageCount > 1 ? <Pagination page={current} pageCount={pageCount} onPageChange={setPage} ariaLabel="アカウントのページ送り" /> : null}
      </div>
    </>
  )

  return (
    <ListPage
      boardId="JKjsE"
      title="統括のアカウント"
      description={`${tenantName || 'この統括'}に属する LINE 公式アカウントです。ここから各アカウントへ入れます。`}
      folders={folderColumn}
      folderInset
      folderNav={{ rows: folderRows, activeId: folder, onSelect: selectFolder, createAction: createAccount, label: 'フォルダ' }}
    >
      <div className={styles.body}>
        <PlatformNotices />
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

      <Dialog
        open={folderDialog !== null}
        title={folderDialog?.editing ? 'フォルダの名前と色を変える' : 'フォルダを追加'}
        description="アカウントは1つのフォルダに入ります。フォルダを消しても、アカウントは消えません。"
        onCancel={() => { if (!folderSaving) setFolderDialog(null) }}
        designNode="JKjsE"
        busy={folderSaving}
        error={folderError || undefined}
        confirmLabel={folderDialog?.editing ? '保存する' : '追加する'}
        cancelLabel="やめる"
        onConfirm={() => void saveFolder()}
      >
        <div className={styles.dialogFields}>
          <label htmlFor="hq-account-folder-name" className={styles.dialogLabel}>フォルダの名前</label>
          <TextField id="hq-account-folder-name" value={folderName} maxLength={100} disabled={folderSaving} placeholder="例: 渋谷エリア" onChange={(event) => setFolderName(event.target.value)} className={styles.full} />
          <label htmlFor="hq-account-folder-color" className={styles.dialogLabel}>色</label>
          <Select id="hq-account-folder-color" aria-label="フォルダの色" value={folderColor} onChange={setFolderColor} disabled={folderSaving} options={FOLDER_COLORS} />
        </div>
      </Dialog>

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
          onConfirm={() => void removeFolder(deleteFolder)}
          onCancel={() => { if (!folderSaving) setDeleteFolder(null) }}
        />
      ) : null}
    </ListPage>
  )
}

/** 数のカード（統括は角丸のカード4枚。題と、数の横に単位の2段。B-33）。 */
function StatCard({ label, value, unit, title, warn = false }: { label: string; value: string; unit: string; title?: string; warn?: boolean }) {
  return (
    <div className={styles.stat4} title={title}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statLine}>
        <span className={warn ? `${styles.statValue} ${styles.statWarn}` : styles.statValue}>{value}</span>
        <span className={styles.statSub}>{unit}</span>
      </span>
    </div>
  )
}
