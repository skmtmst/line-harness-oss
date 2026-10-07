'use client'

/*
 * ★V8 統括のアカウント（ホーム）（Pencil `JKjsE`。カードの「設定」で開く窓が `HMpVx`）。
 *
 * v7 の画面（app/hq/page.tsx と account-browser-v8.tsx）と読み書きの口・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左のタグの列（型のフォルダの列＋共通 FolderPanel）・
 * 数のカード4枚・探す欄と状態の札・カード／表の切り替え・並び・件数・アカウントのカード・件数と注。
 */
import { CircleDot, Info, Inbox, LogIn, Plus, RotateCcw, Settings, Star, MessageCircle } from 'lucide-react'
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
import { api, fetchApi, type LineAccountTag } from '@/lib/api'
import { resolveStoreReturnPath } from '@/lib/hq-navigation'
import { formatNumber } from '@/lib/format'
import { useStaffRole } from '@/lib/staff-role'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import { AccountArchiveDialogV8, AccountRestoreDialogV8, AccountSettingsDialogV8, accountHandle } from './account-dialogs'
import styles from './home.module.css'

type StatusFilter = 'all' | 'ok' | 'warn' | 'archived'
type View = 'cards' | 'table'

/** 「タグなし」を表す印。空文字は「すべて」なので別の値にする。 */
const UNTAGGED = '__untagged__'
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

/** タグの色（追加の窓で選ぶ）。値はテーマの色の名前。 */
const TAG_COLORS = [
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
  const canManage = role === 'owner' || role === 'admin'
  const isOwner = role === 'owner'
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
  const [tag, setTag] = useState<string>(ALL)
  const [view, setView] = useState<View>('cards')
  const [sort, setSort] = useState('friends')
  const [size, setSize] = useState(20)
  const [page, setPage] = useState(1)
  const [tags, setTags] = useState<LineAccountTag[]>([])
  const [tagDialog, setTagDialog] = useState(false)
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('')
  const [deleteTag, setDeleteTag] = useState<LineAccountTag | null>(null)
  const [tagError, setTagError] = useState('')
  const [tagSaving, setTagSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const accountResponse = await api.lineAccounts.list()
    if (!accountResponse.success) throw new Error(accountResponse.error)
    setAccounts(accountResponse.data as AccountWithStats[])
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const res = await api.lineAccountTags.list()
      if (res.success && Array.isArray(res.data)) setTags(res.data)
    } catch {
      // タグが読めなくても一覧は出す
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
    void loadTags()
    let cancelled = false
    void api.tenants.me().then((res) => {
      if (!cancelled && res.success) setTenantName(res.data.name ?? '')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [loadTags])

  const reloadAfterSave = async () => {
    await Promise.all([load(), refreshAccounts(), loadTags()])
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

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of accounts) for (const t of account.tags ?? []) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
    return counts
  }, [accounts])
  const untaggedCount = useMemo(() => accounts.filter((account) => (account.tags ?? []).length === 0).length, [accounts])

  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase()
    const list = accounts.filter((account) => {
      if (!matchesStatus(account, status)) return false
      if (tag === UNTAGGED && (account.tags ?? []).length > 0) return false
      if (tag !== ALL && tag !== UNTAGGED && !(account.tags ?? []).some((t) => t.id === tag)) return false
      if (!words) return true
      const hay = [account.name, account.displayName, account.basicId, account.channelId, ...(account.tags ?? []).map((t) => t.name)]
      return hay.some((text) => text?.toLocaleLowerCase().includes(words))
    })
    return [...list].sort((a, b) =>
      sort === 'name'
        ? (a.displayName || a.name).localeCompare(b.displayName || b.name, 'ja')
        : sort === 'display'
          ? a.displayOrder - b.displayOrder
          : (b.stats?.friendCount ?? 0) - (a.stats?.friendCount ?? 0),
    )
  }, [accounts, status, tag, query, sort])

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

  const createTag = async () => {
    const name = tagName.trim()
    if (!name || tagSaving) return
    setTagSaving(true)
    setTagError('')
    try {
      const color = tagColor ? getComputedStyle(document.documentElement).getPropertyValue(tagColor).trim() : null
      const res = await api.lineAccountTags.create({ name, color })
      if (!res.success) throw new Error(res.error)
      setTagName('')
      setTagDialog(false)
      await loadTags()
      void reloadAfterSave()
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : 'タグを追加できませんでした')
    } finally {
      setTagSaving(false)
    }
  }

  const removeTag = async (target: LineAccountTag) => {
    if (tagSaving) return
    setTagSaving(true)
    setTagError('')
    try {
      const response = await api.lineAccountTags.remove(target.id)
      if (!response.success) throw new Error(response.error)
      setDeleteTag(null)
      if (tag === target.id) setTag(ALL)
      await loadTags()
      void reloadAfterSave()
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : 'タグを消せませんでした')
    } finally {
      setTagSaving(false)
    }
  }

  const folderRows: FolderPanelRow[] = [
    { id: ALL, label: 'すべて', count: accounts.length, icon: <Inbox size={15} aria-hidden="true" /> },
    ...tags.map((t) => ({
      id: t.id,
      label: t.name,
      count: tagCounts.get(t.id) ?? 0,
      color: t.color,
      onDelete: canManage ? () => { setTagError(''); setDeleteTag(t) } : undefined,
      deleteNote: 'タグを消しても、アカウントは消えません。',
    })),
    { id: UNTAGGED, label: 'タグなし', count: untaggedCount },
  ]

  const folders = (
    <div className={styles.folderInset}>
      <FolderPanel
        createAction={canManage ? (
          <Button href="/accounts/new" variant="primary" className={styles.createButton}>
            <Plus aria-hidden="true" className={styles.buttonIcon} />アカウントを登録
          </Button>
        ) : null}
        heading="タグ"
        rows={folderRows}
        activeId={tag}
        onSelect={(id) => { setTag(id); resetPage() }}
        onAddFolder={canManage ? () => { setTagName(''); setTagColor(''); setTagError(''); setTagDialog(true) } : undefined}
        addFolderLabel="タグを追加"
      >
        <p className={styles.folderNote}>タグを消しても、アカウントは消えません</p>
      </FolderPanel>
    </div>
  )

  const cardActions = (account: AccountWithStats) => {
    if (isArchived(account)) {
      return (
        <div className={styles.cardButtons}>
          <Button className={styles.grow} onClick={() => setEditingAccount(account)}>
            <Info aria-hidden="true" className={styles.buttonIcon} />詳細
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

  const metaOf = (account: AccountWithStats) => {
    const parent = nameOf((account as { parentLineAccountId?: string | null }).parentLineAccountId)
    return [`@${accountHandle(account)}`, parent ? `親：${parent}` : null, `権限者 ${formatNumber(account.stats?.staffCount ?? 0)} 人`].filter(Boolean).join(' ・ ')
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
        <StatCard label="アカウント" value={formatNumber(accounts.length)} sub="件" />
        <StatCard label="友だち合計" value={formatNumber(totals.friends)} sub="人・全アカウントの合計" />
        <StatCard label="今月の配信" value={formatNumber(totals.messages)} sub="通" />
        <StatCard label="接続に問題" value={formatNumber(totals.warnings)} sub="件" warn />
      </div>

      <div className={styles.tools}>
        <div className={styles.searchBox}>
          <SearchField
            aria-label="アカウント名・LINE ID・タグで探す"
            placeholder="アカウント名・LINE ID・タグで探す"
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
                  <span className={styles.logo} aria-hidden="true">{brandInitial(name)}</span>
                  <div className={styles.cardName}>
                    {/* 絵 `JKjsE`：名前の前に左の列（タグ）の色の丸。付けたタグが無ければ色の無い輪。 */}
                    <p className={styles.name} title={name}>
                      <FolderDotName folder={(account.tags ?? [])[0] ? { name: (account.tags ?? [])[0].name, color: (account.tags ?? [])[0].color } : null}>{name}</FolderDotName>
                    </p>
                    <p className={styles.meta}>{metaOf(account)}</p>
                  </div>
                  <span className={state.tone === 'ok' ? `${styles.pill} ${styles.pill_ok}` : state.tone === 'warn' ? `${styles.pill} ${styles.pill_warn}` : `${styles.pill} ${styles.pill_idle}`}><span className={styles.dot} aria-hidden="true" />{state.label}</span>
                </div>
                {(account.tags ?? []).length > 0 ? (
                  <ul className={styles.tags} aria-label="付けたタグ">
                    {(account.tags ?? []).map((t) => <li key={t.id} className={styles.tag}>{t.name}</li>)}
                  </ul>
                ) : null}
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
                {warned ? (
                  <p className={styles.warnLine}>
                    <span>LINE ID・接続状態を確かめてください</span>
                    <button type="button" onClick={() => void refreshConnectionInfo()} disabled={checkingConnections} className={styles.linkButton}>更新する</button>
                  </p>
                ) : null}
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
                  <span className={styles.logo} aria-hidden="true">{brandInitial(name)}</span>
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
        <p className={styles.footNote}>カードの「設定」から、タグの付け外し・名前・親アカウントを変えられます。アーカイブしたアカウントは「詳細」と「戻す」だけです（戻すのはオーナー・本人確認のあと「停止中」に戻ります）。</p>
        {pageCount > 1 ? <Pagination page={current} pageCount={pageCount} onPageChange={setPage} ariaLabel="アカウントのページ送り" /> : null}
      </div>
    </>
  )

  return (
    <ListPage
      boardId="JKjsE"
      title="統括のアカウント"
      description={`${tenantName || 'この統括'}に属する LINE 公式アカウントです。ここから各アカウントへ入れます。`}
      actions={accounts.length > 0 && canManage ? (
        <button type="button" className={`${styles.linkButton} ${styles.headAction}`} onClick={() => void refreshConnectionInfo()} disabled={checkingConnections || loading}>
          {checkingConnections ? '接続情報を更新中…' : 'LINE ID・接続状態を更新する'}
        </button>
      ) : undefined}
      folders={folders}
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
        open={tagDialog}
        title="タグを追加"
        description="付けたタグで左の列から絞り込めます。タグを消しても、アカウントは消えません。"
        onCancel={() => setTagDialog(false)}
        designNode="JKjsE"
        busy={tagSaving}
        error={tagError || undefined}
        confirmLabel="追加する"
        cancelLabel="やめる"
        onConfirm={() => void createTag()}
      >
        <div className={styles.dialogFields}>
          <label htmlFor="hq-account-tag-name" className={styles.dialogLabel}>タグの名前</label>
          <TextField id="hq-account-tag-name" value={tagName} maxLength={100} disabled={tagSaving} placeholder="例: 渋谷エリア" onChange={(event) => setTagName(event.target.value)} className={styles.full} />
          <label htmlFor="hq-account-tag-color" className={styles.dialogLabel}>色</label>
          <Select id="hq-account-tag-color" aria-label="タグの色" value={tagColor} onChange={setTagColor} disabled={tagSaving} options={TAG_COLORS} />
        </div>
      </Dialog>

      {deleteTag ? (
        <ConfirmDialog
          open
          title={`タグ「${deleteTag.name}」を消しますか？`}
          description="タグを消しても、アカウントは消えません。付けていたアカウントからタグが外れます。"
          confirmLabel="消す"
          destructive
          busy={tagSaving}
          error={tagError || undefined}
          onConfirm={() => void removeTag(deleteTag)}
          onCancel={() => { if (!tagSaving) setDeleteTag(null) }}
        />
      ) : null}
    </ListPage>
  )
}

/** 数のカード（統括は角丸のカード4枚。題・数・単位の3段）。 */
function StatCard({ label, value, sub, warn = false }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={styles.stat4}>
      <span className={styles.statLabel}>{label}</span>
      <span className={warn ? `${styles.statValue} ${styles.statWarn}` : styles.statValue}>{value}</span>
      <span className={styles.statSub}>{sub}</span>
    </div>
  )
}
