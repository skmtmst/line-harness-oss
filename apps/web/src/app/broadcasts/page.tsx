'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import type { Folder, Tag } from '@line-crm/shared'
import { ApiError, api, type ApiBroadcast, type BroadcastInsight, type BroadcastListKpis, type BroadcastSavedView } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import BroadcastKpis from '@/components/broadcasts/broadcast-kpis'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import BroadcastDetail from '@/components/broadcasts/broadcast-detail'
import FolderPanel from '@/components/shared/folder-panel'
import ListState from '@/components/shared/list-state'
import { audienceSummary, rowExcerpt } from '@/lib/broadcast-summary'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import Button from '@/components/shared/button'

const statusConfig: Record<
  ApiBroadcast['status'],
  { label: string; className: string }
> = {
  draft: { label: '下書き', className: 'bg-canvas-sunken text-ink-secondary' },
  scheduled: { label: '予約済み', className: 'bg-info-bg text-info' },
  sending: { label: '送信中', className: 'bg-warning-bg text-warning' },
  sent: { label: '送信済み', className: 'bg-success-bg text-success' },
}

/**
 * 配信日時。**JSTで書く。**
 *
 * `timeZone` を渡さないと、動かしている端末の時計で書き出す。開発機が
 * UTC+7 だと 9時予約が 7時と出るし、日をまたぐと日付そのものがずれる。
 * 予約の時刻は入力も保存も JST を前提にしているので、読む側もそろえる。
 */
function formatDatetime(iso: string | null): string {
  if (!iso) return '未設定'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function BroadcastsPageContent() {
  const searchParams = useSearchParams()
  const detailId = searchParams.get('id')

  // If ?id=xxx is present, show detail view
  if (detailId) {
    return <BroadcastDetail broadcastId={detailId} />
  }

  return <BroadcastList />
}

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

function BroadcastList() {
  usePageTitle('一斉配信')
  const { selectedAccountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [listKpis, setListKpis] = useState<BroadcastListKpis | null | undefined>(undefined)
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /*
   * **権限不足を「読み込み失敗」に混ぜない。** 直し方がまったく違う——
   * 失敗は読み直せば直るが、権限不足は誰かに権限を足してもらうしかない。
   * 同じ枠で「もう一度試す」を出すと、何度押しても直らない道へ誘う。
   */
  const [forbidden, setForbidden] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'draft'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [openTemplatePicker, setOpenTemplatePicker] = useState(false)
  // タイトルの絞り込み（設計 `Body` の「タイトルで検索」）。
  // 一覧が増えると、配信名を覚えていても探すのに時間がかかる。
  const [titleQuery, setTitleQuery] = useState('')
  /*
   * 配信日で絞る。
   *
   * 一覧が伸びると、「先月の配信を見たい」だけのために延々とめくることになる。
   * 見るのは予約中なら予約の日、送信済みなら送った日。列と同じ日付を見る。
   */
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  /** 選んでいるフォルダ。空は「すべて」、UNFILED は「未分類」。 */
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [insights, setInsights] = useState<Record<string, BroadcastInsight>>({})
  const [fetchingInsight, setFetchingInsight] = useState<string | null>(null)
  /*
   * 一覧のページ送り・件数・並び順。APIの limit/cursor/status/folderId/sort と
   * 連動する。全件取得→手元絞り込みだったのを、口側のページ送りで読む。
   * タイトル・日付の絞り込みだけは手元に残す(打つたびに取り直すと重い)。
   */
  const [pageSize, setPageSize] = useState(20)
  const [sortKey, setSortKey] = useState<'newest' | 'oldest'>('newest')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMoreBroadcasts, setLoadingMoreBroadcasts] = useState(false)
  const [listTotal, setListTotal] = useState<number | null>(null)
  /**
   * 削除の確認。ブラウザの `confirm()` は「この配信を削除してもよいですか？」
   * としか言えず、予約が取り消されることも、送った記録が残ることも読めない。
   * 画像比較にも写らないので、共通の `ConfirmDialog` へ移した（設計 `H2S1T4`）。
   */
  const [deleteTarget, setDeleteTarget] = useState<ApiBroadcast | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [savedViews, setSavedViews] = useState<BroadcastSavedView[]>([])
  const [savedViewName, setSavedViewName] = useState('')
  const [savedViewOpen, setSavedViewOpen] = useState(false)
  const [savedViewBusy, setSavedViewBusy] = useState(false)
  const [savedViewError, setSavedViewError] = useState('')

  /*
   * 一覧に同梱の集計(insightSummary)を、行の表示形に直す。
   * 値が1つも無い(未送信・未取得)ときは undefined で、手動の取得ボタンを出す。
   * 以前は送信済みごとに getInsight を自動発行(N+1)していたが、一覧1回で
   * 足りるようになった。LINEへの再取得は下の手動ボタンに寄せる。
   */
  const summaryInsight = (summary: ApiBroadcast['insightSummary']): BroadcastInsight | undefined => {
    if (!summary) return undefined
    if (summary.delivered == null && summary.uniqueImpression == null
      && summary.uniqueClick == null && summary.openRate == null && summary.clickRate == null) {
      return undefined
    }
    return {
      delivered: summary.delivered,
      uniqueImpression: summary.uniqueImpression,
      uniqueClick: summary.uniqueClick,
      uniqueMediaPlayed: null,
      openRate: summary.openRate,
      clickRate: summary.clickRate,
    }
  }

  /*
   * 一覧同梱の集計が無い送信済みだけ1回ずつ取る。新しい口では summary で
   * 足りるが、旧い口・目視確認用の mock には同梱が無いため、数が空欄に
   * ならないよう不足分だけ補う(二重取り防止の済み印付き)。
   */
  const fetchedInsightIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const missing = broadcasts.filter((b) =>
      b.status === 'sent'
      && !insights[b.id]
      && !summaryInsight(b.insightSummary)
      && !fetchedInsightIdsRef.current.has(b.id))
    if (missing.length === 0) return
    missing.forEach((b) => {
      fetchedInsightIdsRef.current.add(b.id)
      api.broadcasts.getInsight(b.id).then((res) => {
        if (res.success && res.data) {
          setInsights((prev) => ({ ...prev, [b.id]: res.data as BroadcastInsight }))
        }
      }).catch(() => undefined)
    })
  }, [broadcasts, insights])

  const handleFetchInsight = async (id: string) => {
    setFetchingInsight(id)
    try {
      const res = await api.broadcasts.fetchInsight(id)
      if (res.success && res.data) {
        setInsights(prev => ({ ...prev, [id]: res.data }))
      }
    } catch {
      setError('インサイトの取得に失敗しました')
    } finally {
      setFetchingInsight(null)
    }
  }

  const loadFolders = useCallback(async () => {
    setFolderError('')
    try {
      const res = await api.folders.list('broadcast')
      if (res.success) setFolders(res.data)
      else setFolderError('フォルダを読み込めませんでした。')
    } catch {
      setFolderError('フォルダを読み込めませんでした。')
    }
  }, [])

  useEffect(() => { void loadFolders() }, [loadFolders])

  const moveFolder = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const targetResult = await api.folders.update(target.id, { displayOrder: neighbor.displayOrder })
      if (!targetResult.success) throw new Error(targetResult.error)
      const neighborResult = await api.folders.update(neighbor.id, { displayOrder: target.displayOrder })
      if (!neighborResult.success) throw new Error(neighborResult.error)
      await loadFolders()
    } catch {
      setFolderError('並び順を変えられませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async () => {
    if (!deletingFolder || folderBusy) return
    const targetId = deletingFolder.id
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(targetId)
      if (!res.success) throw new Error(res.error)
      setDeletingFolder(null)
      if (folderFilter === targetId) setFolderFilter('')
      await loadFolders()
    } catch {
      setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const load = useCallback(async (cursor?: string | null, append = false) => {
    if (append) {
      if (loadingMoreBroadcasts) return
      setLoadingMoreBroadcasts(true)
    } else {
      setLoading(true)
    }
    setError('')
    setForbidden(false)
    try {
      const [broadcastsRes, tagsRes] = await Promise.all([
        api.broadcasts.list({
          accountId: selectedAccountId || undefined,
          limit: pageSize,
          cursor: cursor ?? undefined,
          // 状態・フォルダは口側で絞る。タイトル・日付は手元で絞る。
          status: statusFilter === 'all' ? undefined : statusFilter,
          folderId: folderFilter === UNFILED ? 'unfiled' : folderFilter || undefined,
          sort: sortKey,
        }),
        append ? null : api.tags.list(),
      ])
      if (broadcastsRes.success) {
        if (append) {
          const rows = broadcastsRes.data
          setBroadcasts((prev) => {
            const seen = new Set(prev.map((b) => b.id))
            return [...prev, ...rows.filter((r) => !seen.has(r.id))]
          })
        } else {
          setBroadcasts(broadcastsRes.data)
        }
        setListKpis(broadcastsRes.kpis)
        setNextCursor(broadcastsRes.pagination?.nextCursor ?? null)
        setListTotal(broadcastsRes.pagination?.total ?? null)
      }
      else setError(broadcastsRes.error)
      if (tagsRes && tagsRes.success) setTags(tagsRes.data)
    } catch (err) {
      /* 403 は読み直しても直らない。失敗と別の1枚にする。 */
      if (err instanceof ApiError && err.status === 403) setForbidden(true)
      else setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      if (append) setLoadingMoreBroadcasts(false)
      else setLoading(false)
    }
  }, [selectedAccountId, pageSize, sortKey, statusFilter, folderFilter, loadingMoreBroadcasts])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedAccountId) {
      setSavedViews([])
      return
    }
    let cancelled = false
    api.broadcasts.savedViews.list(selectedAccountId).then((res) => {
      if (!cancelled && res.success) setSavedViews(res.data)
    }).catch(() => {
      if (!cancelled) setSavedViewError('保存した検索を読み込めませんでした。')
    })
    return () => { cancelled = true }
  }, [selectedAccountId])

  const applySavedView = (id: string) => {
    const view = savedViews.find((item) => item.id === id)
    if (!view) return
    const filters = view.filters
    setTitleQuery(typeof filters.titleQuery === 'string' ? filters.titleQuery : '')
    setStatusFilter(filters.statusFilter === 'scheduled' || filters.statusFilter === 'draft' ? filters.statusFilter : 'all')
    setDateFrom(typeof filters.dateFrom === 'string' ? filters.dateFrom : '')
    setDateTo(typeof filters.dateTo === 'string' ? filters.dateTo : '')
    setFolderFilter(typeof filters.folderFilter === 'string' ? filters.folderFilter : '')
  }

  const saveCurrentView = async () => {
    if (!selectedAccountId || !savedViewName.trim() || savedViewBusy) return
    setSavedViewBusy(true)
    setSavedViewError('')
    try {
      const res = await api.broadcasts.savedViews.create(selectedAccountId, {
        name: savedViewName.trim(),
        filters: { titleQuery, statusFilter, dateFrom, dateTo, folderFilter },
        sortKey: 'scheduled',
        pageSize: 20,
      })
      if (!res.success) throw new Error(res.error)
      setSavedViews((current) => [...current, res.data])
      setSavedViewName('')
      setSavedViewOpen(false)
    } catch {
      setSavedViewError('この検索条件を保存できませんでした。')
    } finally {
      setSavedViewBusy(false)
    }
  }

  const handleDelete = async () => {
    // 押している間は受け付けない。二度押しの2回目は404になり、
    // 消えているのに「削除できませんでした」と出る。
    if (!deleteTarget || deleting) return
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.broadcasts.delete(targetId)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      await load()
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError('この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const getTagName = (tagId: string | null) => {
    if (!tagId) return null
    return tags.find((t) => t.id === tagId)?.name ?? null
  }

  // タブで分類: 1アカウントへの配信 (multi-account-dedup 以外) と 複数アカウントの重複除外配信 を分ける。
  // 全件タブは未フィルタ。サイドバー account context のフィルタは API 側で済んでる。
  // 状態・フォルダは口側で絞り済み。タイトル・日付だけ手元で絞る。
  const visibleBroadcasts = broadcasts.filter((b) => {
    // タイトルは手元で絞る。打つたびに取り直すと重い。
    const query = titleQuery.trim().toLowerCase()
    if (query && !`${b.title} ${b.messageContent}`.toLowerCase().includes(query)) {
      return false
    }
    if (dateFrom || dateTo) {
      // 一覧の「配信日時」列と同じものを見る。送信済みは送った日、それ以外は予約日。
      const iso = b.status === 'sent' ? b.sentAt : b.scheduledAt
      if (!iso) return false
      // JST の日付で比べる。UTC のまま切ると、夜の配信が前日に入る。
      const ymd = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
      if (dateFrom && ymd < dateFrom) return false
      if (dateTo && ymd > dateTo) return false
    }
    return true
  })

  return (
    <div>
      {folderDialogOpen && (
        <FolderAddDialog
          kind="broadcast"
          note="配信を分けてしまう箱です。消しても、入っていた配信は未分類として残ります。"
          placeholder="例: 01_キャンペーン"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {editingFolder && (
        <FolderAddDialog
          kind="broadcast"
          folder={editingFolder}
          note="配信を分けてしまう箱です。削除しても、中の配信は未分類に残ります。"
          placeholder="例: 01_キャンペーン"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void loadFolders() }}
        />
      )}

      <div data-design="KPIs">
      <BroadcastKpis
        unavailable={loading || Boolean(error) || forbidden || (!loading && broadcasts.length === 0)}
        listKpis={loading ? undefined : listKpis}
      />
      </div>

      <div data-design="Head" className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFolderDialogOpen(true)}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
        >
          フォルダを追加
        </button>
        <button
          type="button"
          aria-label="新規配信を作成"
          onClick={() => { setOpenTemplatePicker(false); setShowCreate(true) }}
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info"
        >
          配信を作成
        </button>
      </div>

      {/* 一覧本体（設計 `Body`）。 */}
      <div data-design="Body">
          {/* 設計はフォルダを左の縦パネルに置く。タグ・シナリオと同じ形。 */}
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            {/*
              件数は読み込んだ範囲での数。まだ奥があるときだけ口の total を
              総数に出す(読み込んだ分だけを総数に見せない)。全部読めていれば
              従来どおりの数え方で、見た目は変わらない。
            */}
            <FolderPanel
              total={listTotal !== null && listTotal > broadcasts.length
                ? `全${listTotal}件`
                : `${broadcasts.length} 件`}
              activeId={folderFilter}
              onSelect={setFolderFilter}
              rows={[
                { id: '', label: 'すべて', count: broadcasts.length },
                ...folders.map((f, index) => ({
                  id: f.id,
                  label: f.name,
                  count: broadcasts.filter((b) => b.folderId === f.id).length,
                  color: f.color,
                  // 中央の行なら、上へ／下へを含む設計の5操作を全部撮れる。
                  qaOpen: index === 1 ? 'xkRDb' : undefined,
                  onEdit: () => setEditingFolder(f),
                  onMoveUp: index > 0 ? () => void moveFolder(index, -1) : undefined,
                  onMoveDown: index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
                  onDelete: () => setDeletingFolder(f),
                  deleteNote: '削除しても、中の配信は未分類に残ります。',
                })),
                {
                  id: UNFILED,
                  label: '未分類',
                  count: broadcasts.filter((b) => !b.folderId).length,
                },
              ]}
            >
              <p className="text-ink-faint text-xs leading-relaxed">
                フォルダを消しても、入っていた配信は未分類として残ります。
              </p>
              {folderError ? <p role="alert" className="text-danger text-xs">{folderError}</p> : null}
            </FolderPanel>

            <div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="タイトル・内容で検索"
              aria-label="タイトル・内容で検索"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              className="border-hairline rounded-control bg-canvas focus:ring-accent h-10 min-w-0 flex-1 border px-3 text-sm focus:ring-2 focus:outline-none"
            />
            <SelectField
              aria-label="保存した検索"
              defaultValue=""
              onChange={(event) => applySavedView(event.target.value)}
              options={[
                { value: '', label: '保存した検索' },
                ...savedViews.map((view) => ({ value: view.id, label: view.name })),
              ]}
            />
            <Button type="button" onClick={() => setSavedViewOpen((open) => !open)}>この条件を保存</Button>
            <SelectField
              aria-label="表示件数"
              value={String(pageSize)}
              size="compact"
              onChange={(event) => setPageSize(Number(event.target.value) || 20)}
              options={[
                { value: '20', label: '20件表示' },
                { value: '50', label: '50件表示' },
                { value: '100', label: '100件表示' },
              ]}
            />
          </div>
          {savedViewOpen && (
            <div className="border-hairline bg-canvas mb-3 flex flex-wrap items-center gap-2 rounded-control border p-3">
              <input
                aria-label="保存する検索の名前"
                placeholder="検索条件の名前"
                value={savedViewName}
                onChange={(event) => setSavedViewName(event.target.value)}
                className="border-hairline rounded-control min-w-64 border px-3 py-2 text-sm"
              />
              <Button type="button" variant="primary" disabled={!savedViewName.trim() || savedViewBusy} onClick={() => void saveCurrentView()}>{savedViewBusy ? '保存中…' : '保存'}</Button>
              <Button type="button" onClick={() => setSavedViewOpen(false)}>閉じる</Button>
            </div>
          )}
          {savedViewError && <p role="alert" className="text-danger mb-3 text-xs">{savedViewError}</p>}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="broadcast-filter-chip" data-active={statusFilter === 'scheduled' || undefined} onClick={() => setStatusFilter(statusFilter === 'scheduled' ? 'all' : 'scheduled')}>✓ 予約中のみ</button>
            <button type="button" className="broadcast-filter-chip" data-active={statusFilter === 'draft' || undefined} onClick={() => setStatusFilter(statusFilter === 'draft' ? 'all' : 'draft')}>○ 下書き</button>
            <button type="button" className="broadcast-filter-chip" disabled title="非表示状態は現在の契約にありません">○ 非表示</button>
            <button type="button" className="broadcast-filter-chip" disabled title="開封率による絞り込みは未接続です">○ 開封率が低い</button>
            <span className="text-ink-faint ml-1 text-xs whitespace-nowrap">配信日</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="配信日（開始）"
              className="border-hairline rounded-control border px-2 py-2 text-sm"
            />
            <span className="text-ink-faint text-xs">〜</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="配信日（終了）"
              className="border-hairline rounded-control border px-2 py-2 text-sm"
            />
            <SelectField
              aria-label="並び順"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value === 'oldest' ? 'oldest' : 'newest')}
              options={[
                { value: 'newest', label: '配信日が新しい順' },
                { value: 'oldest', label: '配信日が古い順' },
              ]}
            />
            {(dateFrom || dateTo) && <button type="button" className="text-xs font-semibold text-action" onClick={() => { setDateFrom(''); setDateTo('') }}>日付を外す</button>}
          </div>

      {/* 読み込み失敗の帯。**権限不足のときは出さない**（下で別の1枚を出す）。 */}
      {error && !forbidden && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <BroadcastForm
          tags={tags}
          onSuccess={() => { setShowCreate(false); load() }}
          onCancel={() => setShowCreate(false)}
          openTemplatePickerInitially={openTemplatePicker}
        />
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-hairline flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-hairline rounded w-48" />
                <div className="h-2 bg-canvas-sunken rounded w-32" />
              </div>
              <div className="h-5 bg-canvas-sunken rounded-full w-16" />
              <div className="h-3 bg-canvas-sunken rounded w-24" />
            </div>
          ))}
        </div>
      ) : forbidden ? (
        /*
          権限不足。**「ありません」とも「失敗しました」とも別の1枚**にする。
          読み直しても直らないので、誰に頼めばよいかを言う。
        */
        <ListState kind="forbidden" title="配信を見る権限がありません" />
      ) : broadcasts.length === 0 && !showCreate ? (
        /* 読み込みに失敗したときは「ありません」と言わない。消えたように読めるため。 */
        error ? (
          <ListState
            kind="error"
            title="表示できませんでした"
            description="再読み込みしても直らないときは、エラー報告へお知らせください。"
          />
        ) : (
          /* 文言は設計 `TmHjF`（6-1-N）どおり。 */
          <ListState kind="empty" title="まだ配信がありません" description="最初の1つを作ると、ここに並びます。" />
        )
      ) : visibleBroadcasts.length === 0 ? (
        <ListState
          kind="empty"
          title="条件に該当する配信はありません"
          description="絞り込みを変えるか、新しく作成してください。"
        />
      ) : (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            {/*
              列は設計 `q76C35`（V6 6-1 一斉配信）の6列。
              タイトル・内容／状態／配信条件／配信日時／配信・開封・クリック／操作。

              前は見出しが8つ、中身が7つで**1列ずれていた**。「開封（率）」の
              下に状態バッジ、「状態」の下に削除ボタンが並んでいて、表として
              読めていなかった。設計どおり6列にそろえ、見出しと中身の数を
              合わせる。「配信数」と「開封（率）」は設計では1つの列
              （配信・開封・クリック）にまとまっている。
            */}
            <thead>
              <tr className="bg-canvas-sunken border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">
                  タイトル・内容
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">
                  状態
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">
                  配信条件
                </th>
                {/*
                  予約中なら予約の時刻、送信済みなら送った時刻。
                  2列に分けると、どちらか一方が常に空になる。
                */}
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">
                  配信日時
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">
                  配信・開封・クリック
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {visibleBroadcasts.map((broadcast) => {
                const statusInfo = statusConfig[broadcast.status]
                const isDedup = broadcast.targetType === 'multi-account-dedup'
                // 手動で取り直した値があればそれを、一覧同梱の集計があればそれを使う。
                const insight = insights[broadcast.id] ?? summaryInsight(broadcast.insightSummary)

                return (
                  <tr key={broadcast.id} className="hover:bg-canvas-sunken transition-colors">
                    {/*
                      タイトル・内容。設計は「8月キャンペーンのお知らせ」の下に
                      「キャンペーン告知／画像＋テキスト 2通」と出す。一覧から
                      中身を思い出せないと、開いて確かめることになる。
                    */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <a href={`/broadcasts?id=${broadcast.id}`} className="text-sm font-medium text-action hover:text-action-hover hover:underline">
                          {broadcast.title}
                        </a>
                        {isDedup && (
                          <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                            複数アカウント
                          </span>
                        )}
                      </div>
                      {/*
                        前は text / image 以外をすべて「Flex」と出していた。
                        スタンプもカルーセルも位置情報も「Flex」に見えるので、
                        一覧で中身を確かめられなかった。
                      */}
                      <p className="text-xs text-ink-faint mt-0.5 line-clamp-2 break-all">
                        {rowExcerpt(broadcast.messageType, broadcast.messageContent)}
                      </p>
                    </td>

                    {/* 状態。設計では2列目。 */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>

                    {/*
                      配信条件。前は「全員」か「タグ指定」の2つしか見ていなかったので、
                      詳細条件で絞った配信も「タグ指定」と出ていた。送った相手を
                      後から確かめられないので、監査にならなかった。
                    */}
                    <td className="px-4 py-3 text-sm text-ink-secondary">
                      {audienceSummary(broadcast, getTagName)}
                    </td>

                    <td className="px-4 py-3 text-sm text-ink-faint tabular-nums">
                      {broadcast.status === 'sent'
                        ? formatDatetime(broadcast.sentAt)
                        : formatDatetime(broadcast.scheduledAt)}
                    </td>

                    {/*
                      配信・開封・クリック。送信済みの配信だけ数がある。
                      **まだ送っていない配信に 0件 とは書かない。** 0通届いた
                      のではなく、届く前だから数が無い。
                    */}
                    <td className="px-4 py-3 text-sm text-ink-faint">
                      {broadcast.status !== 'sent' ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <div>
                          {broadcast.totalCount > 0 && (
                            <p>{broadcast.successCount.toLocaleString('ja-JP')} / {broadcast.totalCount.toLocaleString('ja-JP')} 件</p>
                          )}
                          {insight ? (
                            <div className="mt-1 space-y-0.5">
                              {insight.delivered != null && (
                                <p className="text-xs">配信: <span className="font-medium text-ink-secondary">{insight.delivered.toLocaleString('ja-JP')}</span></p>
                              )}
                              {insight.uniqueImpression != null && (
                                <p className="text-xs">開封: <span className="font-medium text-info">{insight.uniqueImpression.toLocaleString('ja-JP')}</span>
                                  {insight.openRate != null && (
                                    <span className="text-ink-faint"> ({(insight.openRate * 100).toFixed(1)}%)</span>
                                  )}
                                </p>
                              )}
                              {insight.uniqueClick != null && (
                                <p className="text-xs">クリック: <span className="font-medium text-success">{insight.uniqueClick.toLocaleString('ja-JP')}</span>
                                  {insight.clickRate != null && (
                                    <span className="text-ink-faint"> ({(insight.clickRate * 100).toFixed(1)}%)</span>
                                  )}
                                </p>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => handleFetchInsight(broadcast.id)}
                              disabled={fetchingInsight === broadcast.id}
                              className="mt-1 text-xs text-action hover:text-action-hover disabled:opacity-50"
                            >
                              {fetchingInsight === broadcast.id ? '取得中...' : 'インサイトを取得'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(broadcast.status === 'draft' || broadcast.status === 'scheduled') && (
                          <button
                            onClick={() => { setDeleteError(''); setDeleteTarget(broadcast) }}
                            className="rounded-control p-2 text-danger transition-colors hover:bg-danger-bg"
                            aria-label={`${broadcast.title}を削除`}
                            title="削除"
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          {/*
            口側ページ送りの続き。押すと次のカーソルから足す。
            件数・タブを変えると先頭から取り直す(load の依存で自動)。
          */}
          {nextCursor && (
            <button
              type="button"
              onClick={() => { void load(nextCursor, true) }}
              disabled={loadingMoreBroadcasts}
              className="text-success hover:bg-accent-soft w-full border-t border-hairline px-4 py-3 text-sm disabled:opacity-50"
            >
              {loadingMoreBroadcasts ? '読み込み中...' : 'さらに読み込む'}
            </button>
          )}
        </div>
      )}
            </div>
          </div>
      </div>

      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中の配信は未分類に残ります。いまこのフォルダに入っているのは${
          deletingFolder ? broadcasts.filter((b) => b.folderId === deletingFolder.id).length : 0
        }件です。`}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onConfirm={() => void removeFolder()}
        onCancel={() => {
          if (folderBusy) return
          setDeletingFolder(null)
          setFolderError('')
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        /*
          **題は設計 `EGMb1` どおり、配信名だけ。**
          「配信「…」を削除しますか？」と接頭辞を付けていたが、設計は
          「「8月キャンペーンのお知らせ」を削除しますか？」。何を消すのかは
          名前で分かるので、種類を足すと読む語が増えるだけになる。
        */
        title={`「${deleteTarget?.title ?? ''}」を削除しますか？`}
        titleIcon={<Trash2 size={18} aria-hidden="true"></Trash2>}
        description="削除すると配信設定と確認画面から消えます。予約中の配信は中止され、この操作は取り消せません。"
        confirmLabel="削除する"
        designNode="EGMb1"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />
      <style jsx global>{`
        .broadcast-filter-chip {
          min-height: 32px;
          border: 1px solid var(--color-hairline);
          border-radius: 999px;
          background: var(--color-canvas);
          padding: 0 12px;
          color: var(--color-ink-secondary);
          font-size: 12px;
        }
        .broadcast-filter-chip[data-active='true'] {
          border-color: var(--color-accent);
          background: var(--color-accent-soft);
          color: var(--color-accent);
        }
        .broadcast-filter-chip:disabled { cursor: not-allowed; opacity: .5; }
        [data-design-node='EGMb1'][role='presentation'] {
          align-items: flex-start;
          padding-top: 280px;
        }
        [data-design-node='EGMb1'] [data-design-part='dialog'] {
          width: min(720px, calc(100vw - 32px));
          max-width: 720px;
        }
        [data-design-node='EGMb1'] [data-qa-dialog-callout] {
          gap: 4px;
          border: 0;
          background: transparent;
          padding: 0;
        }
        [data-design-node='EGMb1'] [data-qa-dialog-callout] h2 {
          color: var(--color-ink);
        }
        [data-design-node='EGMb1'] [data-qa-dialog-callout] p {
          color: var(--color-ink-faint);
        }
      `}</style>
    </div>
  )
}

// useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
export default function BroadcastsPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <BroadcastsPageContent />
    </Suspense>
  )
}
