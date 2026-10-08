'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AccountWithStats } from '@/contexts/account-context'
import { accountIconUrl } from '@/components/hq/account-list'
import { api, type LineAccountTag } from '@/lib/api'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { formatNumber } from '@/lib/format'
import { Folder, LayoutGrid, List as ListIcon, LogIn, Plus, Settings } from 'lucide-react'
import './readonly-v8.css'

type StatusFilter = 'all' | 'ok' | 'warn' | 'archived'
type TagFilter = string | null

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'ok', label: '正常' },
  { value: 'warn', label: '要確認' },
  { value: 'archived', label: 'アーカイブ' },
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

function statusChip(account: AccountWithStats) {
  if (isArchived(account)) return <Chip tone="neutral">アーカイブ</Chip>
  if (!account.isActive) return <Chip tone="neutral">停止中</Chip>
  if (account.connection?.status === 'ok') return <Chip tone="ok">正常</Chip>
  if (account.connection?.status === 'warn') return <Chip tone="warn">要確認</Chip>
  return <Chip tone="neutral">未確認</Chip>
}

function AccountName({ account }: { account: AccountWithStats }) {
  const name = account.displayName || account.name
  const src = accountIconUrl(account)
  const handle = account.basicId || account.channelId
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-9 w-9 shrink-0 rounded-control object-cover" />
      ) : (
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent-deep text-body font-bold text-on-accent">
          {name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p title={name} className="truncate text-label font-bold text-ink">{name}</p>
        <p title={handle} className="truncate text-micro text-ink-faint">
          @{handle}・権限者 {formatNumber(account.stats?.staffCount ?? 0)}人
        </p>
      </div>
    </div>
  )
}

export default function AccountBrowser({
  accounts,
  onSelect,
  onSettings,
  onDetail,
  onRestore,
  onRefreshConnection,
  checkingConnections,
  onChanged,
}: {
  accounts: AccountWithStats[]
  onSelect: (id: string) => void
  onSettings: (account: AccountWithStats) => void
  /** アーカイブ済みカードの「詳細」。 */
  onDetail: (account: AccountWithStats) => void
  /** アーカイブ済みカードの「戻す」。 */
  onRestore: (account: AccountWithStats) => void
  /** 要確認カードの「更新する」。全体の接続情報を更新する。 */
  onRefreshConnection: () => void
  checkingConnections: boolean
  /** タグの追加・削除のあとに一覧を読み直す。 */
  onChanged: () => void
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tag, setTag] = useState<TagFilter>(null)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [sort, setSort] = useState('friends')
  const [size, setSize] = useState(20)
  const [page, setPage] = useState(1)
  const [tags, setTags] = useState<LineAccountTag[]>([])
  const [tagDialog, setTagDialog] = useState(false)
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('')
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null)
  const [tagError, setTagError] = useState('')
  const [tagSaving, setTagSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.lineAccountTags.list().then((res) => {
      if (!cancelled && res.success) setTags(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of accounts) {
      for (const t of account.tags ?? []) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
    }
    return counts
  }, [accounts])
  const untaggedCount = useMemo(
    () => accounts.filter((account) => (account.tags ?? []).length === 0).length,
    [accounts],
  )

  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase()
    const list = accounts.filter((account) => {
      if (!matchesStatus(account, status)) return false
      if (tag === 'untagged' && (account.tags ?? []).length > 0) return false
      if (tag && tag !== 'untagged' && !(account.tags ?? []).some((t) => t.id === tag)) return false
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

  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / size)))
  const shown = filtered.slice((current - 1) * size, current * size)
  const resetPage = () => setPage(1)

  const statusCount = (filter: StatusFilter) => accounts.filter((account) => matchesStatus(account, filter)).length

  const canEdit = (account: AccountWithStats) => ['owner', 'admin'].includes(account.role ?? '')

  const createTag = async () => {
    const name = tagName.trim()
    if (!name || tagSaving) return
    setTagSaving(true)
    setTagError('')
    try {
      const res = await api.lineAccountTags.create({ name, color: tagColor ? getComputedStyle(document.querySelector('[data-theme="v8"]') ?? document.documentElement).getPropertyValue(tagColor).trim() : null })
      if (!res.success) throw new Error(res.error)
      setTagName('')
      setTagDialog(false)
      const list = await api.lineAccountTags.list()
      if (list.success) setTags(list.data)
      onChanged()
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : 'タグを追加できませんでした')
    } finally {
      setTagSaving(false)
    }
  }

  const removeTag = async (id: string) => {
    if (tagSaving) return
    setTagSaving(true)
    setTagError('')
    try {
      const response = await api.lineAccountTags.remove(id)
      if (!response.success) throw new Error(response.error)
      const list = await api.lineAccountTags.list()
      if (list.success) setTags(list.data)
      setDeleteTagId(null)
      onChanged()
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : 'タグを消せませんでした')
    } finally { setTagSaving(false) }
  }

  const cardActions = (account: AccountWithStats) => {
    if (isArchived(account)) {
      return (
        <div className="flex gap-2">
          <Button size="field" className="flex-1" onClick={() => onDetail(account)}>詳細</Button>
          <Button size="field" className="flex-1" onClick={() => onRestore(account)} disabled={!canEdit(account)} title={canEdit(account) ? undefined : '戻すのはオーナーだけができます'}>
            戻す
          </Button>
        </div>
      )
    }
    return (
      <div className="flex gap-2">
        <Button size="field" className="flex-1" onClick={() => onSelect(account.id)} aria-label={`${account.displayName || account.name} へ入る`}>
          <LogIn aria-hidden="true" className="h-4 w-4" />入る
        </Button>
        <Button
          size="field"
          disabled={!canEdit(account)}
          title={canEdit(account) ? undefined : '設定の変更はオーナー・管理者が行えます'}
          onClick={() => onSettings(account)}
          aria-label={`${account.displayName || account.name} の設定`}
        >
          <Settings aria-hidden="true" className="h-4 w-4" />設定
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex w-full shrink-0 flex-col gap-3 xl:w-56">
        <Button href="/accounts/new" variant="primary">
          <Plus aria-hidden="true" className="h-4 w-4" />アカウントを登録
        </Button>
        <div className="flex flex-col" style={{ gap: 2 }} aria-label="タグで絞り込み">
          <p className="px-2 py-1 text-micro font-semibold text-ink-faint">タグ</p>
          <TagRow selected={tag === null} onSelect={() => { setTag(null); resetPage() }} name="すべて" count={accounts.length} />
          {tags.map((t) => (
            <TagRow
              key={t.id}
              selected={tag === t.id}
              onSelect={() => { setTag(t.id); resetPage() }}
              name={t.name}
              count={tagCounts.get(t.id) ?? 0}
              color={t.color}
            />
          ))}
          <TagRow selected={tag === 'untagged'} onSelect={() => { setTag('untagged'); resetPage() }} name="タグなし" count={untaggedCount} />
          <button
            type="button"
            onClick={() => { setTagName(''); setTagError(''); setTagDialog(true) }}
            className="flex items-center gap-2 rounded-control px-2 py-1.5 text-label text-action hover:bg-canvas-sunken"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />タグを追加
          </button>
          <p className="px-2 text-micro text-ink-faint">タグを消しても、アカウントは消えません</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <SearchField
          aria-label="アカウント名・LINE ID・タグで探す"
          placeholder="アカウント名・LINE ID・タグで探す"
          value={query}
          onChange={(value) => { setQuery(value); resetPage() }}
          onClear={() => { setQuery(''); resetPage() }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((item) => (
            <FilterChip
              key={item.value}
              selected={status === item.value}
              onChange={() => { setStatus(item.value); resetPage() }}
              count={statusCount(item.value)}
            >
              {item.label}
            </FilterChip>
          ))}
          <span className="flex-1" />
          <div className="flex items-center gap-1" role="group" aria-label="表示の切り替え">
            <button
              type="button"
              aria-pressed={view === 'cards'}
              title="カードで見る"
              aria-label="カードで見る"
              onClick={() => setView('cards')}
              className={view === 'cards' ? 'rounded-control bg-ink p-2 text-on-accent' : 'rounded-control p-2 text-ink-secondary hover:bg-canvas-sunken'}
            >
              <LayoutGrid aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-pressed={view === 'table'}
              title="表で見る"
              aria-label="表で見る"
              onClick={() => setView('table')}
              className={view === 'table' ? 'rounded-control bg-ink p-2 text-on-accent' : 'rounded-control p-2 text-ink-secondary hover:bg-canvas-sunken'}
            >
              <ListIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <Select
            aria-label="アカウントの並び順"
            value={sort}
            onChange={(value) => { setSort(value); resetPage() }}
            options={[
              { value: 'friends', label: '並び：友だち順' },
              { value: 'name', label: '並び：名前順' },
              { value: 'display', label: '並び：登録順' },
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

        {shown.length === 0 ? (
          <ListState kind="empty" title="該当するアカウントがありません" description="検索の言葉や絞り込みを変えてください。" />
        ) : view === 'cards' ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((account) => {
              const warned = !isArchived(account) && account.isActive && account.connection?.status === 'warn'
              return (
                <article
                  key={account.id}
                  className={warned ? 'flex flex-col gap-3 rounded-card border border-status-warn bg-canvas p-4' : 'flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4'}
                >
                  <div className="flex items-start justify-between gap-2">
                    <AccountName account={account} />
                    {statusChip(account)}
                  </div>
                  {(account.tags ?? []).length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5" aria-label="付けたタグ">
                      {(account.tags ?? []).map((t) => (
                        <li key={t.id} className="inline-flex items-center rounded-mini border border-hairline bg-canvas px-1.5 py-0.5 text-micro text-ink-secondary">
                          {t.name}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <dl className="flex gap-6">
                    <div>
                      <dt className="text-micro text-ink-faint">友だち</dt>
                      <dd className="text-body font-bold tabular-nums text-ink">{formatNumber(account.stats?.friendCount ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-micro text-ink-faint">今月の配信</dt>
                      <dd className="text-body font-bold tabular-nums text-ink">{formatNumber(account.stats?.messagesThisMonth ?? 0)} 通</dd>
                    </div>
                  </dl>
                  {warned ? (
                    <p className="flex items-center justify-between gap-2 text-micro text-ink-secondary">
                      LINE ID・接続状態を確かめてください
                      <button
                        type="button"
                        onClick={onRefreshConnection}
                        disabled={checkingConnections}
                        className="shrink-0 font-semibold text-action underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        更新する
                      </button>
                    </p>
                  ) : null}
                  {cardActions(account)}
                </article>
              )
            })}
          </div>
        ) : (
          <DataTable>
            <TableHeadRow>
              <Th>アカウント</Th>
              <Th>状態</Th>
              <Th align="right">友だち</Th>
              <Th align="right">今月の配信</Th>
              <Th>操作</Th>
            </TableHeadRow>
            {shown.map((account) => (
              <Tr key={account.id}>
                <Td><AccountName account={account} /></Td>
                <Td>{statusChip(account)}</Td>
                <Td align="right">{formatNumber(account.stats?.friendCount ?? 0)}</Td>
                <Td align="right">{formatNumber(account.stats?.messagesThisMonth ?? 0)}</Td>
                <Td>{cardActions(account)}</Td>
              </Tr>
            ))}
          </DataTable>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <ListRange total={filtered.length} first={filtered.length ? (current - 1) * size + 1 : 0} last={(current - 1) * size + shown.length} />
          <span className="flex-1" />
          <Pagination page={current} pageCount={Math.max(1, Math.ceil(filtered.length / size))} onPageChange={setPage} ariaLabel="アカウントのページ送り" />
        </div>
        <p className="text-micro text-ink-faint">
          カードの「設定」から、タグの付け外し・名前・親アカウントを変えられます。アーカイブしたアカウントは「詳細」と「戻す」だけです。
        </p>
      </div>

      <Dialog
        open={tagDialog}
        title="タグを追加"
        description="付けたタグで左のメニューから絞り込めます。タグを消しても、アカウントは消えません。"
        onCancel={() => setTagDialog(false)}
        designNode="JKjsE"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTagDialog(false)}>やめる</Button>
            <Button variant="primary" onClick={() => void createTag()} disabled={!tagName.trim() || tagSaving} busy={tagSaving} busyLabel="追加中…">
              追加する
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hq-account-tag-name" className="text-label font-medium text-ink">タグの名前</label>
          <TextField
            id="hq-account-tag-name"
            value={tagName}
            maxLength={100}
            disabled={tagSaving}
            placeholder="例: 渋谷エリア"
            onChange={(event) => setTagName(event.target.value)}
            className="w-full"
          />
          <Select aria-label="タグの色" value={tagColor} onChange={setTagColor} disabled={tagSaving} options={[{value:'',label:'なし'},{value:'--color-status-info',label:'青'},{value:'--color-accent-deep',label:'緑'},{value:'--color-status-warn-deep',label:'橙'},{value:'--color-status-danger',label:'赤'},{value:'--color-chip-alt',label:'紫'}]} />
          {tags.map(item => <div key={item.id} className="flex items-center justify-between gap-2 text-label"><span>{item.name}</span>{deleteTagId === item.id ? <div className="flex gap-2"><span>消しますか？</span><Button size="compact" disabled={tagSaving} onClick={() => void removeTag(item.id)}>消す</Button><Button size="compact" onClick={() => setDeleteTagId(null)}>やめる</Button></div> : <Button size="compact" disabled={tagSaving} onClick={() => setDeleteTagId(item.id)}>削除</Button>}</div>)}
          {tagError ? <p className="text-label text-danger" role="alert">{tagError}</p> : null}
        </div>
      </Dialog>
    </div>
  )
}

function TagRow({ selected, onSelect, name, count, color }: { selected: boolean; onSelect: () => void; name: string; count: number; color?: string | null }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={
        selected
          ? 'flex items-center gap-2 rounded-control bg-surface-pearl px-2 py-1.5 text-label font-semibold text-ink'
          : 'flex items-center gap-2 rounded-control px-2 py-1.5 text-label text-ink-secondary hover:bg-canvas-sunken hover:text-ink'
      }
    >
      <Folder aria-hidden="true" className="h-4 w-4" style={color ? { color } : undefined} />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <span className="text-micro text-ink-faint">{count}</span>
    </button>
  )
}
