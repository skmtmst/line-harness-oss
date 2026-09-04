'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Bookmark, Circle, SlidersHorizontal, Star } from 'lucide-react'
import type { SavedSearch, Scenario, Tag } from '@line-crm/shared'
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
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { emptyMessageOf } from './friend-list-empty'
import BulkRunDialog from '@/components/friends/bulk-run-dialog'
import { canRunBulk } from '@/components/friends/bulk-run-view'
import { savedSearchParams, savedSearchSummary } from '@/components/friends/saved-search-utils'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
/*
  検索行の副操作は設計 `PhxG6` で高さ38px。共通Buttonは36pxなので当てない
  （共通Buttonは設計と一致済みで、こちらへ寄せると他画面が動く）。
  幅は設計の実寸：詳細条件110 / 保存した検索130 / 検索70。
*/
const SEARCH_ROW_SECONDARY = 'inline-flex h-9.5 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-v6-control border border-hairline bg-canvas text-label font-semibold text-v6-ink hover:bg-v6-surface-strong'

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type Notice = { title: string; message: string } | null
type LoadStatus = 'loading' | 'ready' | 'error'

function scoreBoundary(raw: string | null) {
  if (raw === null || !/^-?\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

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
  const { selectedAccountId, selectedAccount } = useAccount()
  /* 一括操作はオーナーと管理者だけ。個別操作の権限を越えるため。 */
  const [bulkOpen, setBulkOpen] = useState(false)
  const searchParams = useSearchParams()
  const scoreMin = scoreBoundary(searchParams.get('scoreMin'))
  const scoreMax = scoreBoundary(searchParams.get('scoreMax'))
  const hasScoreRange = scoreMin !== undefined || scoreMax !== undefined
  const audienceId = searchParams.get('audienceId')?.trim() || ''
  const directSavedSearchId = searchParams.get('savedSearch')
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
  const selectedFriendIds = useMemo(() => [...selectedIds], [selectedIds])
  const loadRequestRef = useRef(0)

  /*
    **URLから来る絞り込みも数える。** 行動スコアの「この帯の人を見る」は
    `?scoreMin=` で開く。数え落とすと、その帯に誰もいないときに
    「まだ友だちがいません」と出て、絞り込んだ結果だと分からなくなる。
  */
  const emptyMessage = emptyMessageOf({
    search: searchSubmitted,
    tagId: selectedTagId,
    advanced: advanced !== null,
    others: responseFilter !== 'all'
      || operatorId !== ''
      || scenarioId !== ''
      || attentionOnly
      || hasScoreRange
      || audienceId !== '',
  })

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
    setBulkOpen(false)
    setSelectedIds(new Set())
    try {
      const response = await api.friends.list({
        ...(advanced?.params ?? {}),
        offset: String((page - 1) * pageSize),
        limit: pageSize,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        audienceId: audienceId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        operatorId: operatorId || undefined,
        scenarioId: scenarioId || undefined,
        metadata: attentionOnly ? { __attention: '1' } : undefined,
        scoreMin,
        scoreMax,
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
  }, [advanced, attentionOnly, audienceId, operatorId, page, pageSize, responseFilter, scenarioId, scoreMax, scoreMin, searchSubmitted, selectedAccountId, selectedTagId, sortMode])

  useEffect(() => void loadOptions(), [loadOptions])
  useEffect(() => setPage(1), [selectedAccountId])
  useEffect(() => {
    if (!directSavedSearchId) return
    setAdvanced({
      params: { savedSearchId: directSavedSearchId },
      summary: ['保存した検索を適用中'],
    })
    setPage(1)
  }, [directSavedSearchId])
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

      {hasScoreRange ? (
        <div className="flex items-center justify-between rounded-v6-control border border-v6-accent-border bg-v6-accent-soft px-4 py-2.5 text-xs text-v6-ink-secondary">
          <span>
            行動スコア：{scoreMin !== undefined ? `${scoreMin}点以上` : ''}
            {scoreMin !== undefined && scoreMax !== undefined ? '〜' : ''}
            {scoreMax !== undefined ? `${scoreMax}点以下` : ''}
          </span>
          <Link href="/friends" className="font-semibold text-v6-action hover:underline">この条件を外す</Link>
        </div>
      ) : null}

      <section className={`rounded-v6-card border border-hairline bg-canvas px-4 py-3.5 shadow-v6-card`} data-design="V6SearchPanel" data-design-node="pRHvc">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            resetPageWith(() => setSearchSubmitted(searchInput.trim()))
          }}
          className="flex min-w-0 items-center gap-2.5"
        >
          {/* 検索欄は共通 SearchField（設計 h42 / r8 / アイコン17 / 文字12）。 */}
          <div className="min-w-60 flex-1">
            <SearchField
              className="w-full"
              aria-label="友だち名で検索"
              value={searchInput}
              onChange={(value) => {
                setSearchInput(value)
                if (!value.trim() && searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
              }}
              onClear={() => {
                setSearchInput('')
                if (searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
              }}
              placeholder="名前・LINE名・タグ・メモで検索"
            />
          </div>
          <button
            type="button"
            aria-pressed={advanced !== null}
            onClick={() => setAdvancedOpen(true)}
            className={`${SEARCH_ROW_SECONDARY} w-27.5 ${advanced ? 'border-v6-accent text-v6-accent-hover' : ''}`}
          >
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            詳細条件
          </button>
          <button
            type="button"
            onClick={() => setSavedOpen(true)}
            className={`${SEARCH_ROW_SECONDARY} w-32.5 text-v6-action`}
          >
            <Bookmark aria-hidden="true" className="h-4 w-4" />
            保存した検索
          </button>
          {/* 並び順は共通 Select。設計の幅は未実測のため現行210pxを保つ。 */}
          <div className="w-52.5 shrink-0">
            <Select
              aria-label="並び順"
              size="full"
              value={sortMode}
              onChange={(value) => resetPageWith(() => setSortMode(value as SortMode))}
              options={[
                { value: 'recent', label: '友だち追加の新しい順' },
                { value: 'oldest', label: '友だち追加の古い順' },
              ]}
            />
          </div>
          <button type="submit" className="inline-flex h-9.5 w-17.5 shrink-0 items-center justify-center whitespace-nowrap rounded-v6-control bg-accent-deep text-label font-bold text-on-accent hover:brightness-92">検索</button>
        </form>

        {advanced?.summary.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-v6-control bg-v6-accent-soft px-3 py-2">
            <span className="text-xs font-bold text-v6-accent-hover">絞り込み中</span>
            {/* 保存条件の札は共通 Chip（設計の印：高さ17 / 文字10・700 / 丸）。 */}
            {advanced.summary.map((summary) => <Chip key={summary} tone="neutral">{summary}</Chip>)}
            <button type="button" onClick={() => resetPageWith(() => setAdvanced(null))} className="ml-auto text-xs font-medium text-v6-action hover:underline">条件を外す</button>
          </div>
        ) : null}

        <div className="mt-2.5 flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-sm font-semibold text-v6-ink-secondary">絞り込み</span>
          {/*
            絞り込み4つは共通 Select（設計 h42 / r8 / 文字13・600）。
            幅は設計の実寸：タグ156 / 対応156 / 担当者176 / シナリオ184。
            共通Selectの standard は176px固定なので、size="full" で外枠に幅を持たせる。
          */}
          <div className="w-39 shrink-0" data-filter="tag">
            <Select
              aria-label="タグで絞り込む"
              size="full"
              label="タグ"
              value={selectedTagId}
              onChange={(value) => resetPageWith(() => setSelectedTagId(value))}
              options={[{ value: '', label: 'すべて' }, ...allTags.map((tag) => ({ value: tag.id, label: tag.name }))]}
            />
          </div>
          <div className="w-39 shrink-0" data-filter="response">
            <Select
              aria-label="対応状況で絞り込む"
              size="full"
              label="対応"
              value={responseFilter}
              onChange={(value) => resetPageWith(() => setResponseFilter(value as ResponseFilter))}
              options={[
                { value: 'all', label: 'すべて' },
                { value: 'unhandled', label: '未対応のみ' },
              ]}
            />
          </div>
          <div className="w-44 shrink-0" data-filter="operator">
            <Select
              aria-label="担当者で絞り込む"
              size="full"
              label="担当者"
              value={operatorId}
              onChange={(value) => resetPageWith(() => setOperatorId(value))}
              options={[{ value: '', label: 'すべて' }, ...operators.map((operator) => ({ value: operator.id, label: operator.name }))]}
            />
          </div>
          <div className="w-46 shrink-0" data-filter="scenario">
            <Select
              aria-label="シナリオで絞り込む"
              size="full"
              label="シナリオ"
              value={scenarioId}
              onChange={(value) => resetPageWith(() => setScenarioId(value))}
              options={[{ value: '', label: 'すべて' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
            />
          </div>
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
            <span className="text-xs text-v6-ink-secondary">対象を確認してから操作を選んでください</span>
            {selectedIds.size > 1 && canRunBulk(selectedAccount?.role) ? (
              <Button
                variant="primary"
                className="ml-auto"
                data-qa-open="IAf7j"
                onClick={() => setBulkOpen(true)}
              >
                操作を選ぶ
              </Button>
            ) : null}
            {selectedIds.size > 1 && !canRunBulk(selectedAccount?.role) ? (
              /* 権限が無いときは押し口を出さない。理由だけ書く。 */
              <span className="text-v6-ink-faint ml-auto text-xs">一括操作ができるのはオーナーと管理者だけです</span>
            ) : null}
          </div>
          {selectedIds.size === 1 ? (
            <div className="mt-2">
              <SingleFriendActions friendId={[...selectedIds][0]} friendName={friends.find((friend) => friend.id === [...selectedIds][0])?.displayName ?? 'この友だち'} tags={allTags} onDone={loadFriends} />
            </div>
          ) : null}
        </section>
      ) : null}

      <BulkRunDialog
        open={bulkOpen}
        friendIds={selectedFriendIds}
        tags={allTags}
        accountId={selectedAccountId}
        onClose={() => setBulkOpen(false)}
        onDone={() => void loadFriends()}
      />

      {loadStatus === 'loading' ? (
        <ListState kind="loading" title="友だちを読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="友だちを表示できませんでした"
          description="登録した友だちは消えていません。再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          onRetry={() => void loadFriends()}
        />
      ) : friends.length === 0 ? (
        /*
          **絞り込んで0件と、そもそも1人もいないのは別のこと。**
          以前はどちらも「検索条件を外すか」と言っていたので、まだ誰も
          友だちになっていないアカウントで、外すべき条件が無いのに
          条件を外せと言われた。共通部品を通して、状態を名前で言えるようにする。
        */
        <ListState kind="empty" title={emptyMessage.title} description={emptyMessage.description} />
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

      <AdvancedSearchDialog open={advancedOpen} accountId={selectedAccountId} tags={allTags} fieldNames={[]} onClose={() => setAdvancedOpen(false)} onApply={(result) => { setAdvanced(result); setAdvancedOpen(false); setPage(1) }} />
      {savedOpen ? (
        <SavedSearchDialog
          accountId={selectedAccountId}
          tags={allTags}
          onClose={() => setSavedOpen(false)}
          onApply={(result) => {
            setAdvanced(result)
            if (result.params.sort) setSortMode(result.params.sort)
            if (result.params.limit && PAGE_SIZE_OPTIONS.includes(Number(result.params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])) {
              setPageSize(Number(result.params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])
            }
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
          <button type="button" onClick={onClose} className="rounded-v6-control bg-accent-deep px-5 py-2 text-sm font-bold text-on-accent hover:brightness-92">確認</button>
        </div>
      </section>
    </div>
  )
}

function SavedSearchDialog({
  accountId,
  tags,
  onClose,
  onApply,
  onOpenAdvanced,
}: {
  accountId: string | null
  tags: Tag[]
  onClose: () => void
  onApply: (result: AdvancedSearchResult) => void
  onOpenAdvanced: () => void
}) {
  const [saved, setSaved] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    if (!accountId) {
      setSaved([])
      setLoading(false)
      return
    }
    void api.savedSearches.list(accountId).then((res) => {
      if (!cancelled && res.success) setSaved(res.data)
    }).catch(() => {
      if (!cancelled) setError('保存した検索を読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [accountId])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-ink/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="saved-search-title" className={`w-full max-w-lg rounded-v6-dialog border border-hairline bg-canvas p-5 shadow-v6-card`} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="saved-search-title" className="text-lg font-bold text-v6-ink">保存した検索</h2>
        {loading ? <p className="mt-4 text-sm text-v6-ink-faint">読み込み中…</p> : null}
        {error ? <p className="mt-4 rounded-v6-control bg-v6-danger-bg p-3 text-sm text-v6-danger">{error}</p> : null}
        {!loading && saved.length > 0 ? (
          <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
            {saved.map((search) => {
              const summary = savedSearchSummary(search.conditions, tags)
              return (
                <button
                  key={search.id}
                  type="button"
                  onClick={() => onApply({ params: savedSearchParams(search.id, search.conditions), summary })}
                  className="w-full rounded-tile border border-v6-divider bg-v6-surface p-4 text-left hover:border-v6-accent"
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-v6-ink">
                    {search.name}
                    <span className="rounded-pill bg-canvas px-2 py-0.5 text-xs font-medium text-v6-ink-faint">{search.isShared ? '全員' : '自分だけ'}</span>
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-v6-ink-secondary">{summary.slice(0, 3).join(' ／ ') || '条件を確認してください'}</span>
                </button>
              )
            })}
          </div>
        ) : !loading ? (
          <div className="mt-4 rounded-tile border border-hairline bg-v6-surface p-4">
            <p className="text-sm font-semibold text-v6-ink-secondary">保存した条件はまだありません。</p>
            <p className="mt-1 text-xs leading-5 text-v6-ink-faint">「詳細条件」で絞り込みを組み、条件を保存すると次回からここで呼び出せます。</p>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-v6-control border border-hairline bg-canvas px-4 py-2 text-sm font-semibold text-v6-ink-secondary hover:bg-v6-surface-strong">閉じる</button>
          {saved.length === 0 ? (
            <button type="button" onClick={onOpenAdvanced} className="rounded-v6-control bg-accent-deep px-5 py-2 text-sm font-bold text-on-accent hover:brightness-92">詳細条件を設定</button>
          ) : null}
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
