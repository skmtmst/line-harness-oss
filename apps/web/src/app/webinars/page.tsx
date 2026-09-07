'use client'

import SelectField from '@/components/shared/select-field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import './webinars.css'
import FolderPanel from '@/components/shared/folder-panel'
import { webinarLoadFailure, type WebinarLoadFailure } from './webinar-load-failure'
import { useAccount } from '@/contexts/account-context'
import { ApiError, webinarApi, type Webinar, type WebinarFolder, type WebinarListItem, type WebinarOverview } from '@/lib/api'
import { overviewCards } from './overview-view'

const STATUS_LABEL: Record<Webinar['status'], string> = {
  draft: '下書き', active: '公開中', archived: 'アーカイブ',
}

const STATUS_BADGE: Record<Webinar['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function scheduleSummary(w: Webinar): string {
  if (w.schedule.length === 0) return '未設定'
  const DAYS = ['日', '月', '火', '水', '木', '金', '土']
  const dailyTimes = w.schedule
    .filter((rule) => rule.type === 'daily' && rule.time)
    .map((rule) => rule.time as string)
    .sort()
  const otherRules = w.schedule.filter((rule) => rule.type !== 'daily')
  const parts: string[] = []
  if (dailyTimes.length > 0) {
    const toMinutes = (time: string) => {
      const [hours, minutes] = time.split(':').map(Number)
      return hours * 60 + minutes
    }
    const intervals = dailyTimes.slice(1).map((time, index) => toMinutes(time) - toMinutes(dailyTimes[index]))
    const interval = intervals.length > 0 && intervals.every((value) => value === intervals[0]) ? intervals[0] : null
    parts.push(
      dailyTimes.length === 1
        ? `毎日 ${dailyTimes[0]}`
        : `毎日 ${dailyTimes[0]}〜${dailyTimes[dailyTimes.length - 1]}${interval ? `・${interval}分間隔` : ''}（${dailyTimes.length}枠）`,
    )
  }
  otherRules.forEach((rule) => {
    if (rule.type === 'weekly') parts.push(`毎週${(rule.days ?? []).map((day) => DAYS[day]).join('・')} ${rule.time}`)
    if (rule.type === 'once') parts.push(rule.at ? new Date(rule.at).toLocaleString('ja-JP') : '単発・日時未設定')
  })
  return parts.join(' / ')
}

type SortKey = 'updated' | 'created' | 'name'
type SavedFilter = '' | 'active' | 'draft'

const UNFILED = '__unfiled__'

function WebinarFolderDialog({
  folder,
  busy,
  error,
  onCancel,
  onSave,
}: {
  folder: WebinarFolder | null
  busy: boolean
  error: string
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(folder?.name ?? '')

  return (
    <div className="bg-ink/35 fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="webinar-folder-title">
      <section className="bg-canvas rounded-card w-full max-w-md border border-hairline p-5 shadow-card">
        <h2 id="webinar-folder-title" className="text-ink text-lg font-bold">
          {folder ? 'フォルダ名を変更' : 'フォルダを追加'}
        </h2>
        <p className="text-ink-secondary mt-2 text-sm">ウェビナーを整理する名前を入力してください。</p>
        <label className="text-ink mt-4 block text-sm font-semibold" htmlFor="webinar-folder-name">フォルダ名</label>
        <input
          id="webinar-folder-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() && !busy) onSave(name.trim())
            if (event.key === 'Escape' && !busy) onCancel()
          }}
          className="border-hairline rounded-control focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          placeholder="例: 商品説明"
        />
        {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button variant="primary" onClick={() => onSave(name.trim())} disabled={!name.trim() || busy}>
            {busy ? '保存中…' : '保存する'}
          </Button>
        </div>
      </section>
    </div>
  )
}

function measuredCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ja-JP')}人`
    : '—'
}

function compactPublicationDate(value: string | null | undefined, withTime = false): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const month = date.toLocaleString('ja-JP', { month: 'numeric', timeZone: 'Asia/Tokyo' })
  const day = date.toLocaleString('ja-JP', { day: 'numeric', timeZone: 'Asia/Tokyo' })
  if (!withTime) return `${month}/${day}`
  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' })
  return `${month}/${day} ${time}`
}

function publicationSummary(webinar: WebinarListItem): string {
  if (webinar.publicationState === 'always') return '常時公開'
  if (webinar.publicationState === 'scheduled') return compactPublicationDate(webinar.publicationStartsAt, true) ?? '—'
  if (webinar.publicationState === 'ended') return '公開終了'
  if (webinar.publicationState === 'unset') return '未設定'
  if (webinar.publicationState === 'period') {
    const start = compactPublicationDate(webinar.publicationStartsAt)
    const end = compactPublicationDate(webinar.publicationEndsAt)
    if (start && end) return `${start}〜${end}`
  }
  return scheduleSummary(webinar)
}

function displayStatus(webinar: WebinarListItem): string {
  if (webinar.publicationState === 'scheduled') return '公開予定'
  if (webinar.publicationState === 'ended') return '非公開'
  return STATUS_LABEL[webinar.status]
}

export default function WebinarsPage() {
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const requestGeneration = useRef(0)
  const overviewRequestGeneration = useRef(0)
  const folderRequestGeneration = useRef(0)
  const [items, setItems] = useState<WebinarListItem[]>([])
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [overview, setOverview] = useState<WebinarOverview | null>(null)
  const [loadedOverviewAccountId, setLoadedOverviewAccountId] = useState<string | null>(null)
  const [overviewFailure, setOverviewFailure] = useState<WebinarLoadFailure | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('')
  const [loading, setLoading] = useState(true)
  const [loadFailure, setLoadFailure] = useState<WebinarLoadFailure | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<WebinarListItem | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<WebinarFolder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<WebinarFolder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')

  const visibleItems = loadedAccountId === selectedAccountId ? items : []
  const visibleOverview = loadedOverviewAccountId === selectedAccountId ? overview : null
  const visibleOverviewFailure = loadedOverviewAccountId === selectedAccountId ? overviewFailure : null

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    if (!selectedAccountId) {
      setItems([])
      setLoadedAccountId(null)
      setLoadFailure(null)
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    setLoading(true)
    setItems([])
    setLoadedAccountId(null)
    setLoadFailure(null)
    try {
      const res = await webinarApi.list(accountId)
      if (requestGeneration.current !== generation) return
      /*
        **配列で来なかったら、そこで止める。**
        口の契約は配列（`apps/worker/src/routes/webinars.ts` は
        `data: items.results.map(serializeWebinar)` を返す）だが、器だけが
        違う返事（`{items:[],total:0}` など）が来ると `[...narrowed]` で
        `narrowed is not iterable` になり、**一覧が白い画面になる**。
        読めなかったこととして扱えば、理由と読み直しの口が出る。
      */
      if (!Array.isArray(res.data)) throw new ApiError(500, 'ウェビナーの一覧が読めない形で返りました')
      setItems(res.data)
      setLoadedAccountId(accountId)
    } catch (err) {
      if (requestGeneration.current === generation) setLoadFailure(webinarLoadFailure(err))
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }, [selectedAccountId])

  const refreshOverview = useCallback(async () => {
    const generation = ++overviewRequestGeneration.current
    setOverview(null)
    setLoadedOverviewAccountId(null)
    setOverviewFailure(null)

    if (!selectedAccountId) return

    const accountId = selectedAccountId
    try {
      const res = await webinarApi.overview(accountId)
      if (overviewRequestGeneration.current !== generation) return
      setOverview(res.data)
      setLoadedOverviewAccountId(accountId)
    } catch (err) {
      if (overviewRequestGeneration.current !== generation) return
      setOverviewFailure(webinarLoadFailure(err))
      setLoadedOverviewAccountId(accountId)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  const refreshFolders = useCallback(async () => {
    const generation = ++folderRequestGeneration.current
    setFolders([])
    if (!selectedAccountId) return
    try {
      const response = await webinarApi.folders(selectedAccountId)
      if (folderRequestGeneration.current === generation) {
        setFolders(response.success ? response.data : [])
      }
    } catch {
      if (folderRequestGeneration.current === generation) setFolders([])
    }
  }, [selectedAccountId])

  useEffect(() => {
    setSelectedFolder('')
    void refreshFolders()
  }, [refreshFolders])

  const saveFolder = async (name: string) => {
    if (!selectedAccountId || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      if (editingFolder) {
        await webinarApi.updateFolder(selectedAccountId, editingFolder.id, { name })
      } else {
        await webinarApi.createFolder(selectedAccountId, { name })
      }
      setEditingFolder(null)
      setFolderDialogOpen(false)
      await refreshFolders()
    } catch {
      setFolderError('フォルダを保存できませんでした。もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  const moveFolder = async (index: number, direction: -1 | 1) => {
    if (!selectedAccountId || folderBusy) return
    const otherIndex = index + direction
    const current = folders[index]
    const other = folders[otherIndex]
    if (!current || !other) return
    setFolderBusy(true)
    setFolderError('')
    try {
      await Promise.all([
        webinarApi.updateFolder(selectedAccountId, current.id, { displayOrder: other.displayOrder }),
        webinarApi.updateFolder(selectedAccountId, other.id, { displayOrder: current.displayOrder }),
      ])
      await refreshFolders()
    } catch {
      setFolderError('並び順を保存できませんでした。もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async () => {
    if (!selectedAccountId || !deletingFolder || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      await webinarApi.deleteFolder(selectedAccountId, deletingFolder.id)
      if (selectedFolder === deletingFolder.id) setSelectedFolder('')
      setDeletingFolder(null)
      await Promise.all([refresh(), refreshFolders()])
    } catch {
      setFolderError('フォルダを削除できませんでした。もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  /** 数を出してよいのは、読めたときだけ。 */
  const hasListData = !accountLoading && !loading && loadFailure === null && Boolean(selectedAccountId)

  const filtered = useMemo(() => {
    // タイトルと slug の両方を見る。URLで探すこともあるため。
    const q = query.trim()
    const searched = q
      ? visibleItems.filter((w) => w.title.includes(q) || w.slug.includes(q))
      : visibleItems
    const foldered = selectedFolder === UNFILED
      ? searched.filter((w) => !w.folderId)
      : selectedFolder
        ? searched.filter((w) => w.folderId === selectedFolder)
        : searched
    const narrowed = savedFilter
      ? foldered.filter((w) => w.status === savedFilter)
      : foldered
    return [...narrowed].sort((a, b) => {
      if (sortKey === 'name') return a.title.localeCompare(b.title, 'ja')
      if (sortKey === 'created') return b.createdAt.localeCompare(a.createdAt)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [visibleItems, query, selectedFolder, savedFilter, sortKey])

  useEffect(() => {
    setPage(1)
  }, [query, selectedFolder, savedFilter, sortKey, pageSize, selectedAccountId])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleStart = (currentPage - 1) * pageSize
  const visible = filtered.slice(visibleStart, visibleStart + pageSize)

  const archiveSelected = async () => {
    if (!archiveTarget || archiving) return
    setArchiving(true)
    setArchiveError('')
    try {
      await webinarApi.archive(archiveTarget.id)
      setArchiveTarget(null)
      await Promise.all([refresh(), refreshOverview()])
    } catch (error) {
      setArchiveError(error instanceof ApiError && error.status === 409
        ? '公開中のウェビナーは、先に公開を停止してください。'
        : 'アーカイブできませんでした。状態を読み直して、もう一度お試しください。')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <>
      {visibleOverviewFailure ? (
        <div className="mx-auto mb-4 max-w-[1600px] px-6 pt-4">
          <ListState
            kind={visibleOverviewFailure.kind}
            title={visibleOverviewFailure.title}
            description={visibleOverviewFailure.description}
            action={
              visibleOverviewFailure.retryable
                ? <Button onClick={() => void refreshOverview()}>集計を読み直す</Button>
                : undefined
            }
          />
        </div>
      ) : (
        <div data-design="KPIs" className="mx-auto mb-4 grid max-w-[1600px] grid-cols-1 gap-4 px-6 pt-4 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards(visibleOverview).map((card) => (
            <div key={card.key} className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">{card.title}</p>
              <p
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  card.view.available ? 'text-ink' : 'text-ink-faint'
                }`}
              >
                {card.view.text}
              </p>
              {card.view.note ? <p className="text-ink-faint mt-0.5 text-xs">{card.view.note}</p> : null}
              {card.detail ? <p className="text-ink-faint mt-0.5 text-xs">{card.detail}</p> : null}
            </div>
          ))}
        </div>
      )}
      <div data-design-node="ZC13r" className="mx-auto max-w-[1600px] px-6 pb-10">
        <div data-design="Head" className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => { setFolderError(''); setFolderDialogOpen(true) }} disabled={!selectedAccountId}>フォルダを追加</Button>
          <Button variant="primary" href="/webinars/new">ウェビナーを作成</Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <FolderPanel
            total={hasListData ? `${visibleItems.length}件` : '—'}
            activeId={selectedFolder}
            onSelect={setSelectedFolder}
            rows={[
              { id: '', label: 'すべて', count: visibleItems.length },
              ...folders.map((folder, index) => ({
                id: folder.id,
                label: folder.name,
                count: folder.count,
                color: folder.color,
                onEdit: () => { setFolderError(''); setEditingFolder(folder) },
                onMoveUp: index > 0 ? () => void moveFolder(index, -1) : undefined,
                onMoveDown: index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
                onDelete: () => { setFolderError(''); setDeletingFolder(folder) },
                deleteNote: '削除しても、中のウェビナーは未分類に残ります。',
              })),
              { id: UNFILED, label: '未分類', count: visibleItems.filter((item) => !item.folderId).length },
            ]}
          />

          <section className="min-w-0">
            <div data-design="Bar" className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・内容で検索" aria-label="ウェビナー名で検索" className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none" />
              <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
              <SelectField value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="並び順" options={[{ value: 'updated', label: '更新が新しい順' }, { value: 'created', label: '作成が新しい順' }, { value: 'name', label: '名前順' }]} className="border-hairline rounded-control border px-2 py-2 text-sm" />
              <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
              <SelectField size="compact" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="表示件数" options={[{ value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }, { value: '100', label: '100件表示' }]} />
            </div>

            <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
              {([{ key: 'active', label: '公開中のみ' }, { key: 'draft', label: '下書きのみ' }] as const).map(({ key, label }) => (
                <button key={key} onClick={() => setSavedFilter(savedFilter === key ? '' : key)} aria-pressed={savedFilter === key} className={`rounded-pill border px-3 py-1 text-xs transition-colors ${savedFilter === key ? 'border-accent bg-accent-soft text-ink' : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'}`}>{label}</button>
              ))}
            </div>

            <div className="border-hairline bg-canvas min-h-[360px] overflow-hidden rounded-card border">
              {accountLoading || loading ? (
                <ListState kind="loading" />
              ) : !selectedAccountId ? (
                <div className="p-12 text-center text-sm font-medium text-ink">{accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}</div>
              ) : loadFailure ? (
                <ListState kind={loadFailure.kind} title={loadFailure.title} description={loadFailure.description} action={loadFailure.retryable ? <Button onClick={() => void refresh()}>もう一度読み込む</Button> : undefined} />
              ) : visibleItems.length === 0 ? (
                <ListState kind="empty" title="まだウェビナーがありません" description="動画セミナーの申込と視聴を、ここで管理します。" action={<Button variant="primary" href="/webinars/new">ウェビナーを作る</Button>} />
              ) : filtered.length === 0 ? (
                <ListState kind="empty" title="条件に合うウェビナーはありません" description="検索文字か保存した条件を変えてください。" />
              ) : (
                <>
                  <div className="bg-canvas-sunken text-ink-faint hidden grid-cols-12 gap-3 px-4 py-3 text-xs font-semibold md:grid">
                    <span className="col-span-4">ウェビナー名</span><span className="col-span-2">状態</span><span>申込</span><span>視聴</span><span className="col-span-2">公開期間</span><span className="col-span-2">操作</span>
                  </div>
                  <div className="divide-hairline divide-y">
                    {visible.map((w) => (
                      <div key={w.id} className="grid gap-3 px-4 py-4 md:grid-cols-12 md:items-center">
                        <div className="min-w-0 md:col-span-4"><Link href={`/webinars/edit?id=${w.id}`} className="text-accent block truncate text-sm font-bold hover:underline" title={w.title}>{w.title}</Link><span className="text-ink-faint mt-1 block truncate font-mono text-[11px]" title={`/${w.slug}`}>/{w.slug}</span></div>
                        <div className="md:col-span-2"><span className={`rounded-pill inline-flex px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[w.status]}`}>{displayStatus(w)}</span></div>
                        <div className="text-ink-secondary text-sm tabular-nums" title={w.registrationCount == null ? '申込人数は一覧APIに未接続です。' : undefined}><span className="text-ink-faint md:hidden">申込 </span>{measuredCount(w.registrationCount)}</div>
                        <div className="text-ink-secondary text-sm tabular-nums" title={w.viewerCount == null ? '視聴人数は一覧APIに未接続です。' : undefined}><span className="text-ink-faint md:hidden">視聴 </span>{measuredCount(w.viewerCount)}</div>
                        <div className="text-ink-secondary truncate text-sm md:col-span-2" title={publicationSummary(w)}>{publicationSummary(w)}</div>
                        <div className="flex items-center gap-2 md:col-span-2"><Link href={`/webinars/edit?id=${w.id}`} className="text-accent text-xs font-semibold">編集</Link><button type="button" data-qa-open={w.id === 'webinar-5' ? 'LKuAQ' : undefined} onClick={() => { setArchiveError(''); setArchiveTarget(w) }} className="text-danger text-xs font-semibold" aria-label={`${w.title}をアーカイブ`}>アーカイブ</button></div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {hasListData && filtered.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-ink-faint text-xs tabular-nums">{visibleStart + 1}〜{Math.min(visibleStart + pageSize, filtered.length)}件 / 全{filtered.length}件</p><Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="ウェビナー一覧のページ送り" /></div>
            )}
          </section>
        </div>
      </div>
      {archiveTarget ? <ArchiveReviewBackdrop target={archiveTarget} /> : null}
      <ConfirmDialog
        open={archiveTarget !== null}
        designNode="LKuAQ"
        title="ウェビナーをアーカイブしますか？"
        description={archiveTarget
          ? `「${archiveTarget.title}」は一覧から外れ、新しく使えなくなります。申込者・視聴履歴・CTA・分析結果は消えません。`
          : ''}
        confirmLabel="アーカイブする"
        destructive
        busy={archiving}
        error={archiveError || (archiveTarget ? '申込者・視聴履歴・分析結果は消えません。ウェビナーの一覧には出なくなります。' : undefined)}
        onCancel={() => { if (!archiving) setArchiveTarget(null) }}
        onConfirm={() => void archiveSelected()}
      />
      {(folderDialogOpen || editingFolder) ? (
        <WebinarFolderDialog
          folder={editingFolder}
          busy={folderBusy}
          error={folderError}
          onCancel={() => {
            if (folderBusy) return
            setFolderDialogOpen(false)
            setEditingFolder(null)
            setFolderError('')
          }}
          onSave={(name) => void saveFolder(name)}
        />
      ) : null}
      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中のウェビナーは未分類に残ります。いまこのフォルダに入っているのは${deletingFolder?.count ?? 0}件です。`}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => {
          if (folderBusy) return
          setDeletingFolder(null)
          setFolderError('')
        }}
        onConfirm={() => void removeFolder()}
      />
    </>
  )
}

function ArchiveReviewBackdrop({ target }: { target: WebinarListItem }) {
  return (
    <div className="bg-canvas-sunken fixed inset-y-14 left-64 right-0 z-10 overflow-hidden px-10 py-5" data-design-node="LKuAQ">
      <div className="mx-auto max-w-screen-2xl">
        <p className="text-accent text-xs font-bold">← ウェビナー一覧</p>
        <div className="mt-5 grid gap-4 xl:grid-cols-4">
          <main className="space-y-4 xl:col-span-3">
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h2 className="text-base font-bold text-ink">アーカイブする対象</h2>
              <p className="mt-1 text-xs text-ink-secondary">アーカイブするウェビナーを確認します。</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-bold text-ink-faint">ウェビナー</p><p className="mt-2 rounded-control border border-hairline px-3 py-2 text-sm font-semibold text-ink">{target.title}</p></div><div><p className="text-xs font-bold text-ink-faint">申込者</p><p className="mt-2 rounded-control border border-hairline px-3 py-2 text-sm font-semibold text-ink">{measuredCount(target.registrationCount)}</p></div></div>
            </section>
            <section className="rounded-card border border-hairline bg-canvas p-5">
              <h2 className="text-base font-bold text-ink">アーカイブしたあと</h2>
              <p className="mt-1 text-xs text-ink-secondary">アーカイブすると、一覧から外れて新しく使えなくなります。記録は残ります。</p>
              <div className="mt-4 space-y-3"><div className="rounded-control border border-hairline p-4"><strong className="text-sm text-ink">公開ページ</strong><p className="mt-1 text-xs text-ink-secondary">公開URLが無効になります</p></div><div className="rounded-control border border-hairline p-4"><strong className="text-sm text-ink">分析結果</strong><p className="mt-1 text-xs text-ink-secondary">視聴履歴とCTAの結果は消えません</p></div></div>
            </section>
          </main>
          <aside className="space-y-4">
            <section className="rounded-card border border-hairline bg-canvas p-5"><h2 className="text-sm font-bold text-ink">設定サマリー</h2><dl className="mt-4 divide-y divide-hairline text-xs"><div className="flex justify-between py-3"><dt className="text-ink-faint">状態</dt><dd className="font-semibold text-ink">{STATUS_LABEL[target.status]}</dd></div><div className="flex justify-between py-3"><dt className="text-ink-faint">申込</dt><dd className="font-semibold text-ink">{measuredCount(target.registrationCount)}</dd></div><div className="flex justify-between py-3"><dt className="text-ink-faint">視聴</dt><dd className="font-semibold text-ink">{measuredCount(target.viewerCount)}</dd></div></dl></section>
            <section className="min-h-96 rounded-card bg-line-preview p-5"><p className="text-center text-xs font-bold text-on-accent">LINEプレビュー</p><div className="mt-12 rounded-control bg-canvas p-4 text-xs text-ink">このウェビナーは{target.status === 'active' ? '公開中' : '非公開'}です。</div></section>
          </aside>
        </div>
      </div>
    </div>
  )
}
