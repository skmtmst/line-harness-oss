'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDownWideNarrow, Bookmark, Circle, Search, SlidersHorizontal, Star } from 'lucide-react'
import type { Scenario, Tag } from '@line-crm/shared'
import { api, type FriendListItem } from '@/lib/api'
import FriendKpis from '@/components/friends/friend-kpis'
import FriendListTable from '@/components/friends/friend-list-table'
import AdvancedSearchDialog, { type AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import SingleFriendActions from '@/components/friends/single-friend-actions'
import { useAccount } from '@/contexts/account-context'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import DuplicatesPage from '@/app/duplicates/page'
import MergedUsersPage from '@/app/users/page'
import { EmbeddedPageProvider } from '@/components/layout/embedded-page-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
const SECONDARY_CONTROL = 'h-10 whitespace-nowrap rounded-v6-control border border-hairline bg-canvas px-4 text-sm font-medium text-v6-ink hover:bg-v6-surface-strong'

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type Notice = { title: string; message: string } | null
type LoadStatus = 'loading' | 'ready' | 'error'

const MERGED_TABS = [
  { key: 'list', label: '友だち一覧' },
  { key: 'duplicates', label: '重複検出' },
  { key: 'merged', label: '統合ユーザー' },
  { key: 'uid-migration', label: 'UID移行', href: '/accounts?tab=migration' },
]

function FriendsPageInner({
  onNotice,
  onExportReady,
}: {
  onNotice: (notice: Notice) => void
  onExportReady: (exporter: (() => void) | null) => void
}) {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedSearchResult | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [operatorId, setOperatorId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const loadRequestRef = useRef(0)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const [tagResponse, operatorResponse, scenarioResponse] = await Promise.all([
        api.tags.list(),
        api.operators.list(),
        api.scenarios.list(selectedAccountId ? { accountId: selectedAccountId } : undefined),
      ])
      if (tagResponse.success) setAllTags(tagResponse.data)
      if (operatorResponse.success) setOperators(operatorResponse.data)
      if (scenarioResponse.success) setScenarios(scenarioResponse.data)
    } catch {
      // 選択肢の取得に失敗しても、友だち一覧と検索は使える。
    }
  }, [selectedAccountId])

  const loadFriends = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setFriends([])
    setTotal(0)
    setSelectedIds(new Set())
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
        operatorId: operatorId || undefined,
        scenarioId: scenarioId || undefined,
        metadata: attentionOnly ? { __attention: '1' } : undefined,
      })
      if (requestId !== loadRequestRef.current) return
      if (response.success) {
        setFriends(response.data.items)
        setTotal(response.data.total)
        setSelectedIds(new Set())
        setLoadStatus('ready')
      } else {
        setFriends([])
        setTotal(0)
        setLoadStatus('error')
      }
    } catch {
      if (requestId !== loadRequestRef.current) return
      setFriends([])
      setTotal(0)
      setLoadStatus('error')
    }
  }, [advanced, attentionOnly, operatorId, page, pageSize, responseFilter, scenarioId, searchSubmitted, selectedAccountId, selectedTagId, sortMode])

  useEffect(() => void loadOptions(), [loadOptions])
  useEffect(() => setPage(1), [selectedAccountId])
  useEffect(() => {
    void loadFriends()
    return () => {
      loadRequestRef.current += 1
    }
  }, [loadFriends])
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
      friend.chatStatus === 'unread'
        ? '未対応'
        : friend.chatStatus === 'in_progress'
          ? '対応中'
          : friend.chatStatus === 'on_hold'
            ? '保留'
            : '対応済み',
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

  useEffect(
    () => onExportReady(loadStatus === 'ready' ? exportCurrentPage : null),
    [exportCurrentPage, loadStatus, onExportReady],
  )

  const toggleAttention = useCallback(async (friend: FriendListItem) => {
    const current = String(friend.metadata?.__attention ?? '') === '1'
    try {
      await api.friends.updateMetadata(friend.id, { __attention: current ? null : '1' })
      await loadFriends()
    } catch {
      onNotice({ title: '注目の変更に失敗しました', message: '通信状態を確認して、もう一度お試しください。' })
    }
  }, [loadFriends, onNotice])

  return (
    <div data-friends-design="v6" className="space-y-3.5">
      <FriendKpis />

      <section className={`rounded-v6-card border border-hairline bg-canvas px-4 py-3.5 shadow-v6-card`} data-design="V6SearchPanel" data-design-node="pRHvc">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            resetPageWith(() => setSearchSubmitted(searchInput.trim()))
          }}
          className="flex min-w-0 items-center gap-2.5"
        >
          <label className="relative block min-w-60 flex-1">
            <span className="sr-only">友だち名で検索</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-v6-ink-faint" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => {
                const value = event.target.value
                setSearchInput(value)
                if (!value.trim() && searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
              }}
              placeholder="名前・LINE名・タグ・メモで検索"
              className="h-10.5 w-full rounded-v6-control border border-hairline bg-canvas pl-11 pr-3 text-sm text-v6-ink outline-none transition focus:border-v6-accent focus:ring-2 focus:ring-v6-accent/15"
            />
          </label>
          <button type="button" onClick={() => setAdvancedOpen(true)} className={`${SECONDARY_CONTROL} inline-flex items-center gap-2`}>
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            詳細条件{advanced ? '（設定中）' : ''}
          </button>
          <button
            type="button"
            onClick={() => setSavedOpen(true)}
            className={`${SECONDARY_CONTROL} inline-flex items-center gap-2 text-v6-action`}
          >
            <Bookmark aria-hidden="true" className="h-4 w-4" />
            保存した検索
          </button>
          <label className="relative min-w-52.5">
            <span className="sr-only">並び順</span>
            <ArrowDownWideNarrow aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-v6-ink-secondary" />
            <select value={sortMode} onChange={(event) => resetPageWith(() => setSortMode(event.target.value as SortMode))} className="v6-select h-10.5 w-full rounded-v6-control border border-hairline bg-canvas pl-9 text-sm font-semibold text-v6-ink">
              <option value="recent">友だち追加の新しい順</option>
              <option value="oldest">友だち追加の古い順</option>
            </select>
          </label>
          <button type="submit" className="h-10.5 rounded-v6-control bg-v6-accent px-6 text-sm font-bold text-on-accent hover:bg-v6-accent-hover">検索</button>
        </form>

        {advanced?.summary.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-v6-control bg-v6-accent-soft px-3 py-2">
            <span className="text-xs font-bold text-v6-accent-hover">絞り込み中</span>
            {advanced.summary.map((summary) => <span key={summary} className="rounded-full bg-canvas px-2.5 py-1 text-xs text-v6-ink-secondary">{summary}</span>)}
            <button type="button" onClick={() => resetPageWith(() => setAdvanced(null))} className="ml-auto text-xs font-medium text-v6-action hover:underline">条件を外す</button>
          </div>
        ) : null}

        <div className="mt-2.5 flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-sm font-semibold text-v6-ink-secondary">絞り込み</span>
          <label className="w-37.5 shrink-0">
            <span className="sr-only">タグ</span>
            <select value={selectedTagId} onChange={(event) => resetPageWith(() => setSelectedTagId(event.target.value))} className="v6-select h-10.5 w-full rounded-v6-control border border-hairline bg-canvas text-sm font-semibold text-v6-ink">
              <option value="">タグ：すべて</option>
              {allTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
          <label className="w-37.5 shrink-0">
            <span className="sr-only">対応</span>
            <select value={responseFilter} onChange={(event) => resetPageWith(() => setResponseFilter(event.target.value as ResponseFilter))} className="v6-select h-10.5 w-full rounded-v6-control border border-hairline bg-canvas text-sm font-semibold text-v6-ink">
              <option value="all">対応：すべて</option>
              <option value="unhandled">対応：未対応のみ</option>
            </select>
          </label>
          <label className="w-40 shrink-0">
            <span className="sr-only">担当者</span>
            <select value={operatorId} onChange={(event) => resetPageWith(() => setOperatorId(event.target.value))} className="v6-select h-10.5 w-full rounded-v6-control border border-hairline bg-canvas text-sm font-semibold text-v6-ink">
              <option value="">担当者：すべて</option>
              {operators.map((operator) => <option key={operator.id} value={operator.id}>担当者：{operator.name}</option>)}
            </select>
          </label>
          <label className="w-40 shrink-0">
            <span className="sr-only">シナリオ</span>
            <select value={scenarioId} onChange={(event) => resetPageWith(() => setScenarioId(event.target.value))} className="v6-select h-10.5 w-full rounded-v6-control border border-hairline bg-canvas text-sm font-semibold text-v6-ink">
              <option value="">シナリオ：すべて</option>
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>シナリオ：{scenario.name}</option>)}
            </select>
          </label>
          <button type="button" aria-pressed={responseFilter === 'unhandled'} onClick={() => resetPageWith(() => setResponseFilter(responseFilter === 'unhandled' ? 'all' : 'unhandled'))} className={`inline-flex h-10.5 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-bold text-v6-danger ${responseFilter === 'unhandled' ? 'bg-v6-danger-selected ring-2 ring-v6-danger/30' : 'bg-v6-danger-bg'}`}>
            <Circle aria-hidden="true" className="h-2.5 w-2.5 fill-current" />未対応
          </button>
          <button type="button" aria-pressed={attentionOnly} onClick={() => resetPageWith(() => setAttentionOnly(!attentionOnly))} className={`inline-flex h-10.5 shrink-0 items-center gap-2 rounded-full bg-v6-warning-bg px-4 text-xs font-bold ${attentionOnly ? 'ring-2 ring-v6-warning-strong/30' : ''} text-v6-warning`}>
            <Star aria-hidden="true" className="h-3.5 w-3.5" />注目のみ
          </button>
          <span className="shrink-0 whitespace-nowrap text-xs text-v6-ink-faint">{loadStatus === 'ready' ? `${total.toLocaleString('ja-JP')}件` : '—'}</span>
        </div>
      </section>

      {selectedIds.size > 0 ? (
        <section className={`rounded-v6-card border border-v6-accent-border bg-v6-accent-soft p-3 shadow-v6-card`} data-design="V4BulkBar">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-v6-ink">{selectedIds.size}人を選択中</strong>
            <span className="text-xs text-v6-ink-secondary">選択した友だちにまとめて操作します</span>
            {selectedIds.size > 1 ? (
              <button type="button" onClick={() => onNotice({ title: '一括アクション', message: '複数人への一括更新APIは未接続です。誤操作を防ぐため、送信や変更は実行していません。' })} className="ml-auto rounded-control bg-v6-accent px-4 py-2 text-xs font-bold text-on-accent hover:bg-v6-accent-hover">操作を選ぶ</button>
            ) : null}
          </div>
          {selectedIds.size === 1 ? (
            <div className="mt-2">
              <SingleFriendActions friendId={[...selectedIds][0]} friendName={friends.find((friend) => friend.id === [...selectedIds][0])?.displayName ?? 'この友だち'} tags={allTags} onDone={loadFriends} />
            </div>
          ) : null}
        </section>
      ) : null}

      {loadStatus === 'loading' ? (
        <ListState kind="loading" title="友だちを読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="友だちを表示できませんでした"
          description="登録した友だちは消えていません。再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          action={<Button variant="secondary" onClick={() => void loadFriends()}>友だちを再読み込み</Button>}
        />
      ) : (
        <FriendListTable
          friends={friends}
          total={total}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleAll={(select) => setSelectedIds(select ? new Set(friends.map((friend) => friend.id)) : new Set())}
          page={page}
          pageCount={totalPages}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={(size) => resetPageWith(() => setPageSize(size as (typeof PAGE_SIZE_OPTIONS)[number]))}
          onToggleAttention={toggleAttention}
        />
      )}

      <AdvancedSearchDialog open={advancedOpen} tags={allTags} fieldNames={[]} onClose={() => setAdvancedOpen(false)} onApply={(result) => { setAdvanced(result); setAdvancedOpen(false); setPage(1) }} />
      {savedOpen ? (
        <SavedSearchDialog
          onClose={() => setSavedOpen(false)}
          onApply={(result) => {
            setAdvanced(result)
            setSavedOpen(false)
            setPage(1)
          }}
          onOpenAdvanced={() => {
            setSavedOpen(false)
            setAdvancedOpen(true)
          }}
        />
      ) : null}

      <div className="hidden" data-friends-v6-contract="10,20,30,40,50|compact-pagination|前へ|次へ|no-native-alert|1px-right-1px-down" />
    </div>
  )
}

function NoticeDialog({ notice, onClose }: { notice: Exclude<Notice, null>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-ink/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="friends-notice-title" className={`w-full max-w-md rounded-v6-dialog border border-hairline bg-canvas p-5 shadow-v6-card`} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="friends-notice-title" className="text-lg font-bold text-v6-ink">{notice.title}</h2>
        <p className="mt-2 text-sm leading-6 text-v6-ink-secondary">{notice.message}</p>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-v6-control bg-v6-accent px-5 py-2 text-sm font-bold text-on-accent hover:bg-v6-accent-hover">確認</button>
        </div>
      </section>
    </div>
  )
}

function SavedSearchDialog({
  onClose,
  onApply,
  onOpenAdvanced,
}: {
  onClose: () => void
  onApply: (result: AdvancedSearchResult) => void
  onOpenAdvanced: () => void
}) {
  const [saved, setSaved] = useState<AdvancedSearchResult | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('friends.savedSearch')
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<AdvancedSearchResult>
      if (parsed.params && Array.isArray(parsed.summary) && parsed.summary.every((item) => typeof item === 'string')) {
        setSaved({ params: parsed.params, summary: parsed.summary })
      }
    } catch {
      setSaved(null)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-ink/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="saved-search-title" className={`w-full max-w-lg rounded-v6-dialog border border-hairline bg-canvas p-5 shadow-v6-card`} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="saved-search-title" className="text-lg font-bold text-v6-ink">保存した検索</h2>
        {saved ? (
          <div className="mt-4 rounded-tile border border-hairline bg-v6-surface p-4">
            <p className="text-sm font-bold text-v6-ink">最後に保存した条件</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {saved.summary.map((summary) => <span key={summary} className="rounded-full bg-canvas px-3 py-1.5 text-xs text-v6-ink-secondary">{summary}</span>)}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-tile border border-hairline bg-v6-surface p-4">
            <p className="text-sm font-semibold text-v6-ink-secondary">保存した条件はまだありません。</p>
            <p className="mt-1 text-xs leading-5 text-v6-ink-faint">「詳細条件」で絞り込みを組み、条件を保存すると次回からここで呼び出せます。</p>
          </div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-v6-control border border-hairline bg-canvas px-4 py-2 text-sm font-semibold text-v6-ink-secondary hover:bg-v6-surface-strong">閉じる</button>
          {saved ? (
            <button type="button" onClick={() => onApply(saved)} className="rounded-v6-control bg-v6-accent px-5 py-2 text-sm font-bold text-on-accent hover:bg-v6-accent-hover">この条件で表示</button>
          ) : (
            <button type="button" onClick={onOpenAdvanced} className="rounded-v6-control bg-v6-accent px-5 py-2 text-sm font-bold text-on-accent hover:bg-v6-accent-hover">詳細条件を設定</button>
          )}
        </div>
      </section>
    </div>
  )
}

function FriendsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  const [notice, setNotice] = useState<Notice>(null)
  const [exportCurrentPage, setExportCurrentPage] = useState<(() => void) | null>(null)
  const registerExporter = useCallback(
    (exporter: (() => void) | null) => setExportCurrentPage(() => exporter),
    [],
  )

  return (
    <div data-friends-page="v6" data-design-node="PhxG6">
      {/*
        画面名は共通トップバーだけに置く。本文側のタイトル・説明・マニュアルは
        重複させない（Pencil `PhxG6` / トップバー `cBSCb`）。
        操作は独立した見出し行にせず、タブ `JB0Ki` の右端へ置く。
      */}
      <div className="mb-4" data-design="V6Tabs" data-design-node="JB0Ki">
        <MergedTabs
          basePath="/friends"
          paramName="tab"
          tabs={MERGED_TABS}
          active={tab}
          actions={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {tab === 'list' ? <button type="button" onClick={() => exportCurrentPage?.()} disabled={!exportCurrentPage} className="h-9.5 rounded-v6-control border border-hairline bg-canvas px-4 text-sm font-semibold text-v6-ink-secondary hover:bg-v6-surface-strong disabled:text-v6-ink-disabled">CSVで書き出す</button> : null}
              <Link href="/accounts?tab=migration" className="flex h-9.5 items-center rounded-v6-control border border-hairline bg-canvas px-4 text-sm font-semibold text-v6-action hover:bg-v6-action-soft">UID移行</Link>
            </div>
          )}
        />
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
    <Suspense fallback={<div className="p-6 text-sm text-v6-ink-faint">読み込み中…</div>}>
      <FriendsPageHost />
    </Suspense>
  )
}
