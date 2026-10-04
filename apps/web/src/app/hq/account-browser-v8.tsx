'use client'

/*
 * ★V8-B 統括のアカウントを探す・絞る・入る（板 `JKjsE`）。
 * 左にタグのフォルダ、右に状態の札・カード／表・並び・件数。
 * 数はすべて実データ（`api.lineAccounts.list` が付ける tags・stats・connection）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { AccountWithStats } from '@/contexts/account-context'
import { accountIconUrl } from '@/components/hq/account-list'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { DataTable, TableHeadRow, Th, Td, Tr } from '@/components/shared/table'
import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'
import { formatNumber } from '@/lib/format'
import { Folder, LayoutGrid, List, LogIn, Plus, RotateCcw, Settings } from 'lucide-react'
import './readonly-v8.css'

export interface HqAccountTag {
  id: string
  name: string
  color: string | null
}

/* 一覧APIが付ける tags・archivedAt・parentLineAccountId を読むための幅。 */
export type HqBrowserAccount = AccountWithStats & {
  archivedAt?: string | null
  parentLineAccountId?: string | null
  tags?: HqAccountTag[]
}

type Pill = 'all' | 'ok' | 'warn' | 'archived'
type TagFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'tag'; id: string }

/* 板の札の順番のまま。数つき。 */
const pills: { value: Pill; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'ok', label: '正常' },
  { value: 'warn', label: '要確認' },
  { value: 'archived', label: 'アーカイブ' },
]

/* 止まっているものは要確認に入れる（置き場所のない札を作らないため）。 */
function accountStatus(account: HqBrowserAccount): 'ok' | 'warn' | 'archived' | 'inactive' {
  if (account.archivedAt) return 'archived'
  if (!account.isActive) return 'inactive'
  return account.connection?.status === 'ok' ? 'ok' : 'warn'
}

function matchesPill(account: HqBrowserAccount, pill: Pill): boolean {
  if (pill === 'all') return true
  const status = accountStatus(account)
  if (pill === 'archived') return status === 'archived'
  if (pill === 'ok') return status === 'ok'
  return status === 'warn' || status === 'inactive'
}

function matchesQuery(account: HqBrowserAccount, query: string): boolean {
  const words = query.trim().toLocaleLowerCase()
  if (!words) return true
  const haystack = [
    account.name,
    account.displayName,
    account.basicId,
    account.channelId,
    ...(account.tags ?? []).map((tag) => tag.name),
  ]
  return haystack.some((text) => text?.toLocaleLowerCase().includes(words))
}

function StatusChip({ account }: { account: HqBrowserAccount }) {
  const status = accountStatus(account)
  if (status === 'archived') return <Chip tone="neutral">アーカイブ</Chip>
  if (status === 'inactive') return <Chip tone="neutral">停止中</Chip>
  if (status === 'ok') return <Chip tone="ok">正常</Chip>
  return <Chip tone="warn">要確認</Chip>
}

function AccountFace({ account }: { account: HqBrowserAccount }) {
  const name = account.displayName || account.name
  const src = accountIconUrl(account)
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE公式アカウントのCDN画像
    return <img src={src} alt="" className="v8-ro-hq-face" />
  }
  return (
    <span className="v8-ro-hq-face v8-ro-hq-face-fallback" aria-hidden="true">
      {name.trim().slice(0, 1)}
    </span>
  )
}

/* タグの色の見本。タグ自体の色はデータ（DBの color）で、ここは選ぶ色だけ。 */
const tagColorChoices = [
  { value: '#2563eb', label: '青' },
  { value: '#16a34a', label: '緑' },
  { value: '#ea580c', label: '橙' },
  { value: '#dc2626', label: '赤' },
  { value: '#9333ea', label: '紫' },
  { value: '', label: 'なし' },
]

function TagDialog({ tags, onClose, onChanged }: {
  tags: HqAccountTag[]
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(tagColorChoices[0].value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const save = async () => {
    if (busy) return
    if (!name.trim()) {
      setError('タグの名前を入力してください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetchApi<ApiResponse<{ id: string }>>('/api/line-account-tags', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), color: color || null }),
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setName('')
      onChanged()
    } catch {
      setError('タグを保存できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      /* タグを消してもアカウントは消えない（紐づけだけ消える）。 */
      const res = await fetchApi<ApiResponse<{ id: string }>>(`/api/line-account-tags/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setConfirmDeleteId(null)
      onChanged()
    } catch {
      setError('タグを消せませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title="タグを追加"
      description="フォルダの名前と色を決めます。タグを消しても、アカウントは消えません。"
      confirmLabel="追加"
      busy={busy}
      error={error || undefined}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-ink">名前</span>
          <input
            className="rounded-control border border-hairline bg-canvas px-3 py-2 text-ink"
            value={name}
            maxLength={100}
            disabled={busy}
            placeholder="例：渋谷エリア"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="grid gap-1 text-sm" role="group" aria-label="タグの色">
          <span className="font-bold text-ink">色</span>
          <div className="flex flex-wrap gap-2">
            {tagColorChoices.map((choice) => (
              <button
                key={choice.label}
                type="button"
                aria-pressed={color === choice.value}
                aria-label={`色：${choice.label}`}
                title={choice.label}
                disabled={busy}
                onClick={() => setColor(choice.value)}
                className="v8-ro-hq-swatch"
                style={choice.value ? { backgroundColor: choice.value } : undefined}
                data-empty={choice.value ? undefined : 'true'}
              />
            ))}
          </div>
        </div>
        {tags.length > 0 ? (
          <div className="grid gap-1 text-sm">
            <span className="font-bold text-ink">今のタグ</span>
            <ul className="v8-ro-hq-taglist">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <span className="v8-ro-hq-tagname">
                    <Folder size={14} aria-hidden="true" style={{ color: tag.color ?? undefined }} />
                    {tag.name}
                  </span>
                  {confirmDeleteId === tag.id ? (
                    <span className="v8-ro-hq-tagconfirm">
                      消しますか？
                      <button type="button" disabled={busy} onClick={() => void remove(tag.id)}>
                        消す
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                        やめる
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirmDeleteId(tag.id)}>
                      削除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

export default function AccountBrowser({ accounts, onSelect, onSettings, onShowDetails, onRestore, onRefresh }: {
  accounts: HqBrowserAccount[]
  onSelect: (id: string) => void
  onSettings: (account: HqBrowserAccount) => void
  onShowDetails: (account: HqBrowserAccount) => void
  onRestore: (account: HqBrowserAccount) => void
  onRefresh: (account: HqBrowserAccount) => Promise<void> | void
}) {
  const [query, setQuery] = useState('')
  const [pill, setPill] = useState<Pill>('all')
  const [tagFilter, setTagFilter] = useState<TagFilter>({ kind: 'all' })
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [sort, setSort] = useState('friends')
  const [size, setSize] = useState(20)
  const [page, setPage] = useState(1)
  const [allTags, setAllTags] = useState<HqAccountTag[] | null>(null)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const resetPage = () => setPage(1)

  useEffect(() => {
    let cancelled = false
    void fetchApi<ApiResponse<HqAccountTag[]>>('/api/line-account-tags')
      .then((res) => {
        if (!cancelled && res.success) setAllTags(res.data)
      })
      .catch(() => {
        /* 読めないとき（閲覧のみなど）はアカウント側のタグだけ使う。 */
      })
    return () => { cancelled = true }
  }, [])

  /* フォルダに出すタグ：口が読めれば全部、だめなら付いている分だけ。 */
  const folders = useMemo<HqAccountTag[]>(() => {
    if (allTags) return allTags
    const seen = new Map<string, HqAccountTag>()
    for (const account of accounts) {
      for (const tag of account.tags ?? []) {
        if (!seen.has(tag.id)) seen.set(tag.id, tag)
      }
    }
    return [...seen.values()]
  }, [allTags, accounts])

  const pillCounts = useMemo(() => {
    const counts: Record<Pill, number> = { all: 0, ok: 0, warn: 0, archived: 0 }
    for (const account of accounts) {
      if (!matchesQuery(account, query)) continue
      counts.all += 1
      const status = accountStatus(account)
      if (status === 'archived') counts.archived += 1
      else if (status === 'ok') counts.ok += 1
      else counts.warn += 1
    }
    return counts
  }, [accounts, query])

  /* フォルダの数は札と検索の中での数（タグ絞りは掛けない）。 */
  const folderBase = useMemo(
    () => accounts.filter((account) => matchesPill(account, pill) && matchesQuery(account, query)),
    [accounts, pill, query],
  )
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    let none = 0
    for (const account of folderBase) {
      const tags = account.tags ?? []
      if (tags.length === 0) none += 1
      for (const tag of tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1)
    }
    return { counts, none }
  }, [folderBase])

  const filtered = useMemo(() => {
    const list = folderBase.filter((account) => {
      if (tagFilter.kind === 'none') return (account.tags ?? []).length === 0
      if (tagFilter.kind === 'tag') return (account.tags ?? []).some((tag) => tag.id === tagFilter.id)
      return true
    })
    return [...list].sort((a, b) => {
      if (sort === 'name') return (a.displayName || a.name).localeCompare(b.displayName || b.name, 'ja')
      if (sort === 'friends') return (b.stats?.friendCount ?? 0) - (a.stats?.friendCount ?? 0)
      return a.displayOrder - b.displayOrder
    })
  }, [folderBase, tagFilter, sort])

  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / size)))
  const shown = filtered.slice((current - 1) * size, current * size)
  const parentNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.displayName || account.name])), [accounts])
  const canConfigure = (account: HqBrowserAccount) => ['owner', 'admin'].includes(account.role ?? '')

  const refreshOne = async (account: HqBrowserAccount) => {
    if (refreshingId) return
    setRefreshingId(account.id)
    try {
      await onRefresh(account)
    } finally {
      setRefreshingId(null)
    }
  }

  const cardActions = (account: HqBrowserAccount) => {
    if (account.archivedAt) {
      return (
        <div className="v8-ro-hq-actions">
          <Button type="button" size="field" variant="secondary" onClick={() => onShowDetails(account)}>
            詳細
          </Button>
          <Button
            type="button"
            size="field"
            variant="secondary"
            disabled={!canConfigure(account)}
            title={canConfigure(account) ? undefined : '戻すのはオーナー・管理者が行えます'}
            onClick={() => onRestore(account)}
          >
            <RotateCcw size={14} aria-hidden="true" />
            戻す
          </Button>
        </div>
      )
    }
    return (
      <div className="v8-ro-hq-actions">
        <Button type="button" size="field" variant="secondary" onClick={() => onSelect(account.id)}>
          <LogIn size={14} aria-hidden="true" />
          このアカウントへ入る
        </Button>
        <Button
          type="button"
          size="field"
          variant="secondary"
          disabled={!canConfigure(account)}
          title={canConfigure(account) ? undefined : '設定の変更はオーナー・管理者が行えます'}
          onClick={() => onSettings(account)}
        >
          <Settings size={14} aria-hidden="true" />
          設定
        </Button>
      </div>
    )
  }

  const subline = (account: HqBrowserAccount) => {
    const id = account.basicId || account.channelId
    const parentName = account.parentLineAccountId ? parentNames.get(account.parentLineAccountId) : undefined
    return `@${id}・権限者 ${formatNumber(account.stats?.staffCount ?? 0)}人${parentName ? `・親：${parentName}` : ''}`
  }

  const reloadTags = async () => {
    try {
      const res = await fetchApi<ApiResponse<HqAccountTag[]>>('/api/line-account-tags')
      if (res.success) setAllTags(res.data)
    } catch {
      /* 読めなければ今のフォルダのまま。 */
    }
  }

  return (
    <section className="v8-ro-hq-browser" aria-label="統括のアカウント一覧">
      <aside className="v8-ro-hq-folders" aria-label="タグのフォルダ">
        <Button href="/accounts/new" variant="primary" className="v8-ro-hq-register">
          <Plus size={14} aria-hidden="true" />
          アカウントを登録
        </Button>
        <p className="v8-ro-hq-folders-title">タグ</p>
        <button
          type="button"
          aria-pressed={tagFilter.kind === 'all'}
          onClick={() => { setTagFilter({ kind: 'all' }); resetPage() }}
          className="v8-ro-hq-folder"
        >
          <span className="v8-ro-hq-folder-name">すべて</span>
          <span className="v8-ro-hq-folder-count">{folderBase.length}</span>
        </button>
        {folders.map((tag) => (
          <button
            key={tag.id}
            type="button"
            aria-pressed={tagFilter.kind === 'tag' && tagFilter.id === tag.id}
            onClick={() => { setTagFilter({ kind: 'tag', id: tag.id }); resetPage() }}
            className="v8-ro-hq-folder"
          >
            <span className="v8-ro-hq-folder-name">
              <Folder size={14} aria-hidden="true" style={{ color: tag.color ?? undefined }} />
              {tag.name}
            </span>
            <span className="v8-ro-hq-folder-count">{tagCounts.counts.get(tag.id) ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={tagFilter.kind === 'none'}
          onClick={() => { setTagFilter({ kind: 'none' }); resetPage() }}
          className="v8-ro-hq-folder"
        >
          <span className="v8-ro-hq-folder-name">
            <Folder size={14} aria-hidden="true" />
            タグなし
          </span>
          <span className="v8-ro-hq-folder-count">{tagCounts.none}</span>
        </button>
        <button type="button" onClick={() => setTagDialogOpen(true)} className="v8-ro-hq-tagadd">
          <Plus size={14} aria-hidden="true" />
          タグを追加
        </button>
        <p className="v8-ro-hq-folder-note">タグを消しても、アカウントは消えません</p>
      </aside>
      <div className="v8-ro-hq-content">
        <SearchField
          aria-label="アカウントを検索"
          placeholder="アカウント名・LINE ID・タグで探す"
          value={query}
          onChange={(value) => { setQuery(value); resetPage() }}
          onClear={() => { setQuery(''); resetPage() }}
        />
        <div className="v8-ro-hq-pillbar">
          <div className="v8-ro-hq-pills" role="group" aria-label="状態で絞り込み">
            {pills.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={pill === item.value}
                onClick={() => { setPill(item.value); resetPage() }}
                className="v8-ro-hq-pill"
              >
                {item.label}{' '}
                <span className="v8-ro-hq-pill-count">{pillCounts[item.value]}</span>
              </button>
            ))}
          </div>
          <div className="v8-ro-hq-viewbar">
            <div className="v8-ro-hq-viewswitch" role="group" aria-label="表示の切り替え">
              <button
                type="button"
                aria-pressed={view === 'cards'}
                aria-label="カードで表示"
                title="カード"
                onClick={() => setView('cards')}
              >
                <LayoutGrid size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={view === 'table'}
                aria-label="表で表示"
                title="表"
                onClick={() => setView('table')}
              >
                <List size={15} aria-hidden="true" />
              </button>
            </div>
            <Select
              aria-label="アカウントの並び順"
              value={sort}
              onChange={(value) => { setSort(value); resetPage() }}
              options={[
                { value: 'friends', label: '並び：友だち順' },
                { value: 'display', label: '並び：登録の並び順' },
                { value: 'name', label: '並び：名前順' },
              ]}
            />
            <Select
              aria-label="アカウントの表示件数"
              value={String(size)}
              size="page-size"
              onChange={(value) => { setSize(Number(value)); resetPage() }}
              options={[10, 20, 50].map((value) => ({ value: String(value), label: `${value}件表示` }))}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <ListState kind="empty" title="該当するアカウントがありません" description="検索の言葉や絞り込みを変えてください。" />
        ) : view === 'cards' ? (
          <div className="v8-ro-hq-cards">
            {shown.map((account) => {
              const warn = accountStatus(account) === 'warn'
              return (
                <article
                  key={account.id}
                  className="v8-ro-hq-card"
                  data-warn={warn ? 'true' : undefined}
                  aria-label={account.displayName || account.name}
                >
                  <div className="v8-ro-hq-cardhead">
                    <AccountFace account={account} />
                    <div className="v8-ro-hq-cardtitle">
                      <p title={account.displayName || account.name}>{account.displayName || account.name}</p>
                      <small title={subline(account)}>{subline(account)}</small>
                    </div>
                    <StatusChip account={account} />
                  </div>
                  {(account.tags ?? []).length > 0 ? (
                    <ul className="v8-ro-hq-cardtags" aria-label="付いているタグ">
                      {(account.tags ?? []).map((tag) => (
                        <li key={tag.id}>{tag.name}</li>
                      ))}
                    </ul>
                  ) : null}
                  <dl className="v8-ro-hq-cardstats">
                    <div>
                      <dt>友だち</dt>
                      <dd>{account.archivedAt ? '—' : formatNumber(account.stats?.friendCount ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>今月の配信</dt>
                      <dd>{formatNumber(account.stats?.messagesThisMonth ?? 0)}<span>通</span></dd>
                    </div>
                  </dl>
                  {cardActions(account)}
                  {warn ? (
                    <p className="v8-ro-hq-cardwarn">
                      LINE ID・接続状況を確かめてください
                      <button
                        type="button"
                        disabled={refreshingId !== null}
                        onClick={() => void refreshOne(account)}
                      >
                        {refreshingId === account.id ? '更新中…' : '更新する'}
                      </button>
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th style={{ width: '32%' }}>アカウント</Th>
                <Th>状態</Th>
                <Th align="right">友だち</Th>
                <Th align="right">今月の配信</Th>
                <Th style={{ width: '32%' }}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((account) => (
                <Tr key={account.id}>
                  <Td>
                    <div className="v8-ro-hq-accountName">
                      <AccountFace account={account} />
                      <div>
                        <p title={account.displayName || account.name}>{account.displayName || account.name}</p>
                        <small title={subline(account)}>{subline(account)}</small>
                      </div>
                    </div>
                  </Td>
                  <Td><StatusChip account={account} /></Td>
                  <Td align="right">{account.archivedAt ? '—' : formatNumber(account.stats?.friendCount ?? 0)}</Td>
                  <Td align="right">{formatNumber(account.stats?.messagesThisMonth ?? 0)}</Td>
                  <Td>{cardActions(account)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <div className="v8-ro-hq-footer">
          <p className="v8-ro-hq-rangenote">
            <ListRange
              total={filtered.length}
              first={filtered.length ? (current - 1) * size + 1 : 0}
              last={(current - 1) * size + shown.length}
            />
            {' '}
            カードの「設定」から、タグの付け外し・名前・親アカウントを変えられます。アーカイブしたアカウントは「詳細」と「戻す」だけです（戻すのはオーナー・本人確認のあと「停止中」に戻ります）。
          </p>
          <Pagination
            page={current}
            pageCount={Math.max(1, Math.ceil(filtered.length / size))}
            onPageChange={setPage}
            ariaLabel="アカウントのページ送り"
          />
        </div>
      </div>
      {tagDialogOpen ? (
        <TagDialog
          tags={folders}
          onClose={() => setTagDialogOpen(false)}
          onChanged={() => void reloadTags()}
        />
      ) : null}
    </section>
  )
}
