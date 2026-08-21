'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Tag } from '@line-crm/shared'
import { api, type FriendListItem } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendKpis from '@/components/friends/friend-kpis'
import FriendListTable from '@/components/friends/friend-list-table'
import AdvancedSearchDialog, { type AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import SingleFriendActions from '@/components/friends/single-friend-actions'
import { useAccount } from '@/contexts/account-context'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import DuplicatesPage from '@/app/duplicates/page'
import MergedUsersPage from '@/app/users/page'
import { EmbeddedPageProvider } from '@/components/layout/embedded-page-context'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
const CARD_SHADOW = 'shadow-[1px_1px_2px_rgba(29,29,31,0.13)]'
const SECONDARY_CONTROL = 'h-10 whitespace-nowrap rounded-[9px] border border-[#DADDE2] bg-white px-4 text-sm font-medium text-[#1D1D1F] hover:bg-[#F6F6F8]'

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type Notice = { title: string; message: string } | null

const MERGED_TABS = [
  { key: 'list', label: '友だち一覧' },
  { key: 'duplicates', label: '重複の検出' },
  { key: 'merged', label: '統合ユーザー' },
]

function compactPages(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set([1, total, current - 1, current, current + 1])
  const ordered = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)
  const result: Array<number | 'ellipsis'> = []
  ordered.forEach((page, index) => {
    if (index > 0 && page - ordered[index - 1] > 1) result.push('ellipsis')
    result.push(page)
  })
  return result
}

function FriendsPageInner({
  onNotice,
  onExportReady,
}: {
  onNotice: (notice: Notice) => void
  onExportReady: (exporter: () => void) => void
}) {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedSearchResult | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = useMemo(() => compactPages(page, totalPages), [page, totalPages])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const response = await api.tags.list()
      if (response.success) setAllTags(response.data)
    } catch {
      // タグ取得に失敗しても、友だち一覧は使える。
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.friends.list({
        ...(advanced?.params ?? {}),
        offset: String((page - 1) * pageSize),
        limit: pageSize,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
      })
      if (response.success) {
        setFriends(response.data.items)
        setTotal(response.data.total)
        setSelectedIds(new Set())
      } else {
        setError(response.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [advanced, page, pageSize, responseFilter, searchSubmitted, selectedAccountId, selectedTagId, sortMode])

  useEffect(() => void loadTags(), [loadTags])
  useEffect(() => setPage(1), [selectedAccountId])
  useEffect(() => void loadFriends(), [loadFriends])
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const resetPageWith = (update: () => void) => {
    update()
    setPage(1)
  }

  const exportCurrentPage = useCallback(() => {
    const header = ['友だち名', '対応', 'シナリオ', '最新メッセージ', '登録日']
    const rows = friends.map((friend) => [
      friend.displayName,
      friend.chatStatus === 'unread' ? '未対応' : friend.chatStatus === 'in_progress' ? '対応中' : '対応済み',
      friend.activeScenario?.name ?? '',
      friend.latestIncomingMessage?.content ?? '',
      friend.createdAt.slice(0, 10),
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `friends-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [friends])

  useEffect(() => onExportReady(exportCurrentPage), [exportCurrentPage, onExportReady])

  return (
    <div data-friends-design="v4" className="space-y-4">
      <FriendKpis />

      <section className={`rounded-[14px] border border-[#DADDE2] bg-white p-4 ${CARD_SHADOW}`} data-design="V4SearchPanel">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            resetPageWith(() => setSearchSubmitted(searchInput.trim()))
          }}
          className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto_auto_auto_auto] xl:items-center"
        >
          <label className="relative block min-w-0">
            <span className="sr-only">友だち名で検索</span>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => {
                const value = event.target.value
                setSearchInput(value)
                if (!value.trim() && searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
              }}
              placeholder="友だち名・LINE表示名で検索"
              className="h-10 w-full rounded-[9px] border border-[#DADDE2] bg-white px-3 text-sm text-[#1D1D1F] outline-none transition focus:border-[#07C653] focus:ring-2 focus:ring-[#07C653]/15"
            />
          </label>
          <button type="button" onClick={() => setAdvancedOpen(true)} className={SECONDARY_CONTROL}>
            詳細検索{advanced ? '（設定中）' : ''}
          </button>
          <button
            type="button"
            onClick={() => onNotice({ title: '保存した検索', message: '保存済み検索の呼び出しは、検索条件の保存機能と一緒に実装予定です。' })}
            className={SECONDARY_CONTROL}
          >
            保存した検索
          </button>
          <select value={sortMode} onChange={(event) => resetPageWith(() => setSortMode(event.target.value as SortMode))} className="h-10 rounded-[9px] border border-[#DADDE2] bg-white px-3 text-sm text-[#1D1D1F]">
            <option value="recent">追加が新しい順</option>
            <option value="oldest">追加が古い順</option>
          </select>
          <button type="submit" className="h-10 rounded-[9px] bg-[#07C653] px-5 text-sm font-bold text-white hover:bg-[#079B45]">検索</button>
        </form>

        {advanced?.summary.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[9px] bg-[#E9F9EF] px-3 py-2">
            <span className="text-xs font-bold text-[#079B45]">絞り込み中</span>
            {advanced.summary.map((summary) => <span key={summary} className="rounded-full bg-white px-2.5 py-1 text-xs text-[#565F59]">{summary}</span>)}
            <button type="button" onClick={() => resetPageWith(() => setAdvanced(null))} className="ml-auto text-xs font-medium text-[#0067D9] hover:underline">条件を外す</button>
          </div>
        ) : null}

        <div className="mt-3 grid gap-3 border-t border-[#EAEBED] pt-3 md:grid-cols-[minmax(160px,240px)_minmax(150px,220px)_1fr_auto] md:items-center">
          <label className="flex items-center gap-2 text-xs font-medium text-[#565F59]">
            タグ
            <select value={selectedTagId} onChange={(event) => resetPageWith(() => setSelectedTagId(event.target.value))} className="h-9 min-w-0 flex-1 rounded-[8px] border border-[#DADDE2] bg-white px-2 text-xs text-[#1D1D1F]">
              <option value="">すべて</option>
              {allTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-[#565F59]">
            対応
            <select value={responseFilter} onChange={(event) => resetPageWith(() => setResponseFilter(event.target.value as ResponseFilter))} className="h-9 min-w-0 flex-1 rounded-[8px] border border-[#DADDE2] bg-white px-2 text-xs text-[#1D1D1F]">
              <option value="all">すべて</option>
              <option value="unhandled">未対応のみ</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            {['未対応かつ7日以内', '定期便 契約中', 'ブロック解除者'].map((label) => (
              <button key={label} type="button" onClick={() => onNotice({ title: label, message: 'この保存条件は現在準備中です。条件を確認してから有効化します。' })} className="rounded-full border border-[#DADDE2] bg-white px-3 py-1.5 text-[#565F59] hover:bg-[#F6F6F8]">{label}</button>
            ))}
          </div>
          <span className="whitespace-nowrap text-right text-xs text-[#8B938D]">{loading ? '読み込み中…' : `${total.toLocaleString('ja-JP')}件`}</span>
        </div>
      </section>

      {selectedIds.size > 0 ? (
        <section className={`rounded-[14px] border border-[#A8E9C1] bg-[#E9F9EF] p-3 ${CARD_SHADOW}`} data-design="V4BulkBar">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-[#1D1D1F]">{selectedIds.size}人を選択中</strong>
            <span className="text-xs text-[#565F59]">選択した友だちにまとめて操作します</span>
            {selectedIds.size > 1 ? (
              <button type="button" onClick={() => onNotice({ title: '一括アクション', message: '複数人への一括更新APIは未接続です。誤操作を防ぐため、送信や変更は実行していません。' })} className="ml-auto rounded-[8px] bg-[#07C653] px-4 py-2 text-xs font-bold text-white hover:bg-[#079B45]">操作を選ぶ</button>
            ) : null}
          </div>
          {selectedIds.size === 1 ? (
            <div className="mt-2">
              <SingleFriendActions friendId={[...selectedIds][0]} friendName={friends.find((friend) => friend.id === [...selectedIds][0])?.displayName ?? 'この友だち'} tags={allTags} onDone={loadFriends} />
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <div role="alert" className="rounded-[10px] border border-[#F3B8BB] bg-[#FFF1F2] p-4 text-sm text-[#B4232B]">{error}</div> : null}

      {loading ? (
        <div className={`overflow-hidden rounded-[14px] border border-[#DADDE2] bg-white ${CARD_SHADOW}`}>
          {Array.from({ length: Math.min(pageSize, 8) }, (_, index) => <div key={index} className="h-[66px] animate-pulse border-b border-[#EAEBED] bg-gradient-to-r from-white via-[#F6F6F8] to-white" />)}
        </div>
      ) : (
        <FriendListTable
          friends={friends}
          total={total}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleAll={(select) => setSelectedIds(select ? new Set(friends.map((friend) => friend.id)) : new Set())}
          headerRight={!loading && total > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-[#565F59]">
              <span className="whitespace-nowrap">{(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, total)}件 / 全{total.toLocaleString('ja-JP')}件</span>
              <label className="flex items-center gap-2 whitespace-nowrap">
                表示件数
                <select value={pageSize} onChange={(event) => resetPageWith(() => setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]))} className="h-8 rounded-[8px] border border-[#DADDE2] bg-white px-2 text-xs text-[#1D1D1F]">
                  {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}件</option>)}
                </select>
              </label>
            </div>
          ) : null}
        />
      )}

      {!loading && total > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <nav aria-label="友だち一覧のページ" className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="h-9 rounded-[8px] border border-[#DADDE2] bg-white px-3 text-xs text-[#0067D9] disabled:text-[#B8BCC2]">前へ</button>
            {pageItems.map((item, index) => item === 'ellipsis' ? <span key={`ellipsis-${index}`} className="px-1 text-xs text-[#8B938D]">…</span> : (
              <button key={item} type="button" onClick={() => setPage(item)} aria-current={item === page ? 'page' : undefined} className={`h-9 min-w-9 rounded-[8px] px-2 text-xs font-medium ${item === page ? 'bg-[#07C653] text-white' : 'border border-[#DADDE2] bg-white text-[#0067D9]'}`}>{item}</button>
            ))}
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="h-9 rounded-[8px] border border-[#DADDE2] bg-white px-3 text-xs text-[#0067D9] disabled:text-[#B8BCC2]">次へ</button>
          </nav>
        </div>
      ) : null}

      <AdvancedSearchDialog open={advancedOpen} tags={allTags} fieldNames={[]} onClose={() => setAdvancedOpen(false)} onApply={(result) => { setAdvanced(result); setAdvancedOpen(false); setPage(1) }} />

      <div className="hidden" data-friends-v4-contract="10,20,30,40,50|compact-pagination|no-native-alert|1px-right-1px-down" />
    </div>
  )
}

function NoticeDialog({ notice, onClose }: { notice: Exclude<Notice, null>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="friends-notice-title" className={`w-full max-w-md rounded-[16px] border border-[#DADDE2] bg-white p-5 ${CARD_SHADOW}`} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="friends-notice-title" className="text-lg font-bold text-[#1D1D1F]">{notice.title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#565F59]">{notice.message}</p>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-[9px] bg-[#07C653] px-5 py-2 text-sm font-bold text-white hover:bg-[#079B45]">確認</button>
        </div>
      </section>
    </div>
  )
}

function FriendsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  const [notice, setNotice] = useState<Notice>(null)
  const [exportCurrentPage, setExportCurrentPage] = useState<(() => void) | null>(null)
  const registerExporter = useCallback((exporter: () => void) => setExportCurrentPage(() => exporter), [])

  return (
    <div data-friends-page="v4">
      <div data-design="V4Head">
      <Header
        title="友だち"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setNotice({ title: 'マニュアル', message: '友だち管理のマニュアルは準備中です。公開後、このボタンから開けるようにします。' })} className="rounded-[9px] border border-[#DADDE2] bg-white px-3 py-2 text-sm font-medium text-[#565F59] hover:bg-[#F6F6F8]">マニュアル</button>
            <button type="button" onClick={() => exportCurrentPage?.()} disabled={!exportCurrentPage || tab !== 'list'} className="rounded-[9px] border border-[#DADDE2] bg-white px-3 py-2 text-sm font-medium text-[#0067D9] hover:bg-[#F3F8FF] disabled:text-[#B8BCC2]">CSVで書き出す</button>
            <Link href="/accounts?tab=migration" className="rounded-[9px] border border-[#DADDE2] bg-white px-3 py-2 text-sm font-medium text-[#0067D9] hover:bg-[#F3F8FF]">UID移行</Link>
          </div>
        }
      />
      </div>

      <div className="mb-4" data-design="V4Tabs">
        <MergedTabs basePath="/friends" paramName="tab" tabs={MERGED_TABS} active={tab} />
      </div>
      {tab === 'list' ? <FriendsPageInner onNotice={setNotice} onExportReady={registerExporter} /> : null}
      {tab === 'duplicates' ? <EmbeddedPageProvider><DuplicatesPage /></EmbeddedPageProvider> : null}
      {tab === 'merged' ? <EmbeddedPageProvider><MergedUsersPage /></EmbeddedPageProvider> : null}
      {notice ? <NoticeDialog notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  )
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#8B938D]">読み込み中…</div>}>
      <FriendsPageHost />
    </Suspense>
  )
}
