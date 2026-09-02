'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Folder, Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import BroadcastKpis from '@/components/broadcasts/broadcast-kpis'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import BroadcastDetail from '@/components/broadcasts/broadcast-detail'
import FolderPanel from '@/components/shared/folder-panel'
import { audienceSummary, contentExcerpt, messageTypeLabel } from '@/lib/broadcast-summary'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'

const statusConfig: Record<
  ApiBroadcast['status'],
  { label: string; className: string }
> = {
  draft: { label: '下書き', className: 'bg-canvas-sunken text-ink-secondary' },
  scheduled: { label: '予約済み', className: 'bg-info-bg text-info' },
  sending: { label: '送信中', className: 'bg-warning-bg text-warning' },
  sent: { label: '送信完了', className: 'bg-success-bg text-success' },
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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

type BroadcastTab = 'single' | 'dedup' | 'all'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

function BroadcastList() {
  const { selectedAccountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** よく使う絞り込み。いま数えられるのは「予約中のみ」だけ。 */
  const [scheduledOnly, setScheduledOnly] = useState(false)
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
  const [insights, setInsights] = useState<Record<string, BroadcastInsight>>({})
  const [fetchingInsight, setFetchingInsight] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<BroadcastTab>('all')
  /**
   * 削除の確認。ブラウザの `confirm()` は「この配信を削除してもよいですか？」
   * としか言えず、予約が取り消されることも、送った記録が残ることも読めない。
   * 画像比較にも写らないので、共通の `ConfirmDialog` へ移した（設計 `H2S1T4`）。
   */
  const [deleteTarget, setDeleteTarget] = useState<ApiBroadcast | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const loadInsight = async (id: string) => {
    try {
      const res = await api.broadcasts.getInsight(id)
      if (res.success && res.data) {
        setInsights(prev => ({ ...prev, [id]: res.data! }))
      }
    } catch { /* ignore */ }
  }

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
    const res = await api.folders.list('broadcast')
    if (res.success) setFolders(res.data)
  }, [])

  useEffect(() => { void loadFolders() }, [loadFolders])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [broadcastsRes, tagsRes] = await Promise.all([
        api.broadcasts.list({ accountId: selectedAccountId || undefined }),
        api.tags.list(),
      ])
      if (broadcastsRes.success) setBroadcasts(broadcastsRes.data)
      else setError(broadcastsRes.error)
      if (tagsRes.success) setTags(tagsRes.data)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  // 送信済みbroadcastのinsightを読み込み
  useEffect(() => {
    broadcasts.filter(b => b.status === 'sent').forEach(b => loadInsight(b.id))
  }, [broadcasts])

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

  // タブで分類: 単アカ配信 (multi-account-dedup 以外) と 複アカ重複除外配信 を分ける。
  // 全件タブは未フィルタ。サイドバー account context のフィルタは API 側で済んでる。
  const dedupCount = broadcasts.filter((b) => b.targetType === 'multi-account-dedup').length
  const singleCount = broadcasts.length - dedupCount
  const visibleBroadcasts = broadcasts.filter((b) => {
    // タイトルは手元で絞る。打つたびに取り直すと重い。
    if (titleQuery.trim() && !b.title.toLowerCase().includes(titleQuery.trim().toLowerCase())) {
      return false
    }
    // まだ送っていない予約だけを見る。送る前に中身を直せるのはこれだけ。
    if (scheduledOnly && b.status !== 'scheduled') return false
    if (folderFilter === UNFILED) {
      if (b.folderId) return false
    } else if (folderFilter && b.folderId !== folderFilter) {
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
    if (activeTab === 'all') return true
    if (activeTab === 'dedup') return b.targetType === 'multi-account-dedup'
    return b.targetType !== 'multi-account-dedup'
  })

  return (
    <div>
      {/* 設計 `V2 4-2 一斉配信` */}
      <div data-design="Head">
      <Header
        title="一斉配信"
        description="条件を指定した友だちにメッセージをまとめて送ります。予約配信と開封の計測ができます。"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            {/* 行き先の文書が無いので押せない。仮のリンクは行き止まりになる。 */}
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
            <button
              type="button"
              onClick={() => setFolderDialogOpen(true)}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
            >
              フォルダを追加
            </button>
            <button
              type="button"
              onClick={() => { setOpenTemplatePicker(true); setShowCreate(true) }}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
            >
              テンプレートから配信
            </button>
            <button
              onClick={() => { setOpenTemplatePicker(false); setShowCreate(true) }}
              className="bg-accent text-on-accent transition-colors hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium"
            >
              + 新規配信
            </button>
          </div>
        )}
      />
      </div>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="broadcast"
          note="配信を分けてしまう箱です。消しても、入っていた配信は未分類として残ります。"
          placeholder="例: 01_キャンペーン"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      <div data-design="KPIs">
      <BroadcastKpis />
      </div>

      {/* 一覧本体（設計 `Body`）。 */}
      <div data-design="Body">
          {/* 設計はフォルダを左の縦パネルに置く。タグ・シナリオと同じ形。 */}
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <FolderPanel
              total={`${broadcasts.length} 件`}
              activeId={folderFilter}
              onSelect={setFolderFilter}
              rows={[
                { id: '', label: 'すべて', count: broadcasts.length },
                ...folders.map((f) => ({
                  id: f.id,
                  label: f.name,
                  count: broadcasts.filter((b) => b.folderId === f.id).length,
                  color: f.color,
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
            </FolderPanel>

            <div>

          {/* 検索と並び順（設計 `Body` の上）。 */}
          <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
            <input
              type="search"
              placeholder="タイトルで検索"
              aria-label="タイトルで検索"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
            <select
              disabled
              title="並び替えは準備中です"
              className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
            >
              <option>配信日が新しい順</option>
            </select>
            <span className="text-ink-faint text-xs whitespace-nowrap">配信日</span>
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
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm"
              >
                日付を外す
              </button>
            )}
            <button
              disabled
              title="保存した条件は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
            >
              保存した条件
            </button>
          </div>

          {/*
            よく使う絞り込み。数え方が決まっているのは「予約中のみ」だけ。
            開封率の低さと今月分は、比べる相手や区切りを決める前に押せる
            ようにすると、押した人ごとに違うものを想像する。
          */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-ink-faint text-xs">よく使う</span>
            <button
              onClick={() => setScheduledOnly((v) => !v)}
              className={`rounded-pill px-3 py-1 text-xs transition-colors ${
                scheduledOnly
                  ? 'bg-accent-soft text-accent'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken border'
              }`}
            >
              予約中のみ
            </button>
            {['開封率が低い', '今月分'].map((label) => (
              <button
                key={label}
                disabled
                title="この絞り込みはまだ数えられません"
                className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
              >
                {label}
              </button>
            ))}
          </div>

      {/* Error */}
      {error && (
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

      {/* Tabs */}
      {!loading && broadcasts.length > 0 && (
        <div className="mb-4 flex gap-1 border-b border-hairline">
          {([
            { id: 'all', label: '全部', count: broadcasts.length },
            { id: 'single', label: '単アカ配信', count: singleCount },
            { id: 'dedup', label: '複アカ重複除外', count: dedupCount },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink-secondary'
              }`}
              style={activeTab === tab.id ? { borderColor: 'var(--color-accent)' } : undefined}
            >
              {tab.label}
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0 rounded-full bg-canvas-sunken text-xs text-ink-secondary min-w-[20px]">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
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
      ) : broadcasts.length === 0 && !showCreate ? (
        <div className="bg-canvas rounded-card border border-hairline p-12 text-center">
          {/* 読み込みに失敗したときは「ありません」と言わない。消えたように読めるため。 */}
          <p className="text-ink-faint">
            {error
              ? 'いまは読み込めていません。上の案内をご覧ください。'
              : '配信がありません。「新規配信」から作成してください。'}
          </p>
        </div>
      ) : visibleBroadcasts.length === 0 ? (
        <div className="bg-canvas rounded-card border border-hairline p-12 text-center">
          <p className="text-ink-faint">
            {activeTab === 'dedup' ? '複数アカ重複除外配信はまだありません。' : 'このタブに該当する配信はありません。'}
          </p>
        </div>
      ) : (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-canvas-sunken border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  タイトル
                </th>
                {/*
                  列は設計 `V2 4-2 一斉配信` の並び。
                  「予約日時」と「送信完了日時」を「配信日時」の1列にまとめている。
                  予約中なら予約の時刻、送信済みなら送った時刻。どちらか一方しか
                  意味を持たないので、2列に分けると常に片方が空になる。
                */}
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  配信日時
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  配信条件
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  内容
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  配信数
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  開封（率）
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">
                  状態
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {visibleBroadcasts.map((broadcast) => {
                const statusInfo = statusConfig[broadcast.status]
                const tagName = getTagName(broadcast.targetTagId)
                const isDedup = broadcast.targetType === 'multi-account-dedup'

                return (
                  <tr key={broadcast.id} className="hover:bg-canvas-sunken transition-colors">
                    {/* Title */}
                    <td className="px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <a href={`/broadcasts?id=${broadcast.id}`} className="text-sm font-medium text-action hover:text-action-hover hover:underline">
                            {broadcast.title}
                          </a>
                          {isDedup && (
                            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                              複アカ
                            </span>
                          )}
                        </div>
                        {/*
                          前は text / image 以外をすべて「Flex」と出していた。
                          スタンプもカルーセルも位置情報も「Flex」に見えるので、
                          一覧で中身を確かめられなかった。
                        */}
                        <p className="text-xs text-ink-faint mt-0.5">
                          {messageTypeLabel(broadcast.messageType)}
                        </p>
                      </div>
                    </td>

                    {/*
                      配信日時。予約中なら予約の時刻、送信済みなら送った時刻。
                      2列に分けると、どちらかが常に空になって読みにくい。
                    */}
                    <td className="px-4 py-3 text-sm text-ink-faint">
                      {broadcast.status === 'sent'
                        ? formatDatetime(broadcast.sentAt)
                        : formatDatetime(broadcast.scheduledAt)}
                    </td>

                    {/*
                      配信条件。前は「全員」か「タグ指定」の2つしか見ていなかったので、
                      詳細条件で絞った配信も「タグ指定」と出ていた。送った相手を
                      後から確かめられないので、監査にならなかった。
                    */}
                    <td className="px-4 py-3 text-sm text-ink-secondary">
                      {audienceSummary(broadcast, getTagName)}
                    </td>

                    {/* 内容。一覧から中身を思い出せるように、本文の頭を出す。 */}
                    <td className="px-4 py-3 text-sm text-ink-secondary">
                      <span className="line-clamp-2 break-all">
                        {contentExcerpt(broadcast.messageType, broadcast.messageContent) || '—'}
                      </span>
                    </td>

                    {/* Stats & Insight */}
                    <td className="px-4 py-3 text-sm text-ink-faint">
                      {broadcast.status === 'sent' ? (
                        <div>
                          {broadcast.totalCount > 0 && (
                            <p>{broadcast.successCount.toLocaleString('ja-JP')} / {broadcast.totalCount.toLocaleString('ja-JP')} 件</p>
                          )}
                          {insights[broadcast.id] ? (
                            <div className="mt-1 space-y-0.5">
                              {insights[broadcast.id].delivered != null && (
                                <p className="text-xs">配信: <span className="font-medium text-ink-secondary">{insights[broadcast.id].delivered!.toLocaleString('ja-JP')}</span></p>
                              )}
                              {insights[broadcast.id].uniqueImpression != null && (
                                <p className="text-xs">開封: <span className="font-medium text-info">{insights[broadcast.id].uniqueImpression!.toLocaleString('ja-JP')}</span>
                                  {insights[broadcast.id].openRate != null && (
                                    <span className="text-ink-faint"> ({(insights[broadcast.id].openRate! * 100).toFixed(1)}%)</span>
                                  )}
                                </p>
                              )}
                              {insights[broadcast.id].uniqueClick != null && (
                                <p className="text-xs">クリック: <span className="font-medium text-success">{insights[broadcast.id].uniqueClick!.toLocaleString('ja-JP')}</span>
                                  {insights[broadcast.id].clickRate != null && (
                                    <span className="text-ink-faint"> ({(insights[broadcast.id].clickRate! * 100).toFixed(1)}%)</span>
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
                      ) : (
                        '-'
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(broadcast.status === 'draft' || broadcast.status === 'scheduled') && (
                          <button
                            onClick={() => { setDeleteError(''); setDeleteTarget(broadcast) }}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-danger bg-canvas hover:bg-danger-bg border border-danger-bg rounded-md transition-colors"
                          >
                            削除
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
        </div>
      )}
            </div>
          </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`配信「${deleteTarget?.title ?? ''}」を削除しますか？`}
        description={
          deleteTarget?.status === 'scheduled'
            ? '予約が取り消され、この配信は送られなくなります。下書きの中身も一緒に消えます。すでに送った配信の記録は残ります。この操作は取り消せません。'
            : '下書きの中身が消えます。まだ送っていないので、友だちには何も届きません。この操作は取り消せません。'
        }
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      >
        {deleteTarget && (
          <dl className="text-xs text-ink-secondary space-y-1">
            <div className="flex gap-2">
              <dt className="text-ink-faint shrink-0">配信日時</dt>
              <dd className="min-w-0">{formatDatetime(deleteTarget.scheduledAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-faint shrink-0">送り先</dt>
              <dd className="min-w-0">{audienceSummary(deleteTarget, getTagName)}</dd>
            </div>
          </dl>
        )}
      </ConfirmDialog>
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
