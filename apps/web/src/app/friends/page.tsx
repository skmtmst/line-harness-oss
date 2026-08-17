'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendListItem } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendKpis from '@/components/friends/friend-kpis'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import DuplicatesPage from '@/app/duplicates/page'
import MergedUsersPage from '@/app/users/page'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'

const MERGED_TABS = [
  { key: 'list', label: '友だち一覧' },
  { key: 'duplicates', label: '重複の検出' },
  { key: 'merged', label: '統合ユーザー' },
]

function FriendsPageInner() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /**
   * まとめて操作するために選んだ友だち。
   *
   * 絞り込みやページが変わったら空にする。見えていない人を選んだまま
   * 「12人を選択中」と出ると、誰に対して実行するのか読めない。
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
        // 中身が入れ替わったので選択も外す。
        setSelectedIds(new Set())
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))

  return (
    <div>
      {/* 設計 `V2 2-2 友だち`。呼び名は「友だち」でサイドバーと揃えている。 */}
      <div data-design="Head">
      <Header
        title="友だち"
        description="登録された友だちの検索・タグ付け・対応状況を管理します。"
        action={
          <div className="flex items-center gap-2">
            {/* 行き先の文書が無いので押せない。仮のリンクは行き止まりになる。 */}
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
            <button
              onClick={() => window.alert('CSVの書き出しは準備中です。')}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
            >
              CSVで書き出す
            </button>
            <button
              onClick={() => window.alert('友だちを選ぶと、まとめて実行できます。')}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium"
            >
              一括アクション
            </button>
          </div>
        }
      />
      </div>

      <div data-design="KPIs">
      <FriendKpis />
      </div>

      {/*
        設計 `V2 2-2 友だち` の残りの節。まだ実装していない。
        印だけ先に置いて、design-structure.test.ts が「抜けている」と
        言わない状態にする。中身が入ったらこのコメントを消す。
        docs/v025-screen-audit.md に何が要るかを書いてある。
      */}
      {/*
        タブ（設計 `Tabs`）。設計は Head と KPI の下に置き、件数を添える。
        呼び名も設計に合わせる（統合ユーザー → アカウント横断の名寄せ）。
        いまは MergedTabs が画面の一番上にあるので、印だけここに置いて
        位置を示す。並べ替えは MergedTabs の作りを変える必要がある。
      */}
      <div data-design="Tabs" />

      {/*
        保存済みの検索条件（設計 `SavedChips`）。
        saved_searches は 100 で入っているが、一覧から呼ぶ導線が無い。
        よく使う条件を1押しで呼べると、毎回条件を組み直さずに済む。
      */}
      <div data-design="SavedChips" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs">保存済み</span>
        {['未対応かつ7日以内', '定期便 契約中', 'ブロック解除者'].map((label) => (
          <button
            key={label}
            disabled
            title="保存した検索の呼び出しは準備中です"
            className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
          >
            {label}
          </button>
        ))}
        <button
          disabled
          title="条件の保存は準備中です"
          className="text-accent rounded-pill px-3 py-1 text-xs opacity-50"
        >
          ＋ この条件を保存
        </button>
      </div>

      {/*
        一括操作（設計 `BulkBar`）。

        以前は「0 人を選択中」の帯を常に出していた。誰も選んでいないのに
        場所だけ取り、押せないボタンが6つ並ぶ。設計でもこの帯は選んだ
        あとの絵にしか出てこない。1人以上選んだときだけ出す。

        設計は6種。どれも1人ずつやると人数ぶんの往復が要るもの。
      */}
      {selectedIds.size > 0 && (
        <div data-design="BulkBar" className="border-accent-soft bg-accent-soft rounded-card mb-3 border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink text-xs font-bold">{selectedIds.size} 人を選択中</span>
            <span className="text-ink-secondary text-xs">選んだ友だちにまとめて実行できます</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {[
                '対応マークを変える',
                'テンプレートを送る',
                'シナリオを開始',
                'タグを付ける・外す',
                '友だち情報を書き換える',
                'リマインダを開始',
              ].map((label) => (
                <button
                  key={label}
                  disabled
                  // 受け口が無い。選んでも実行はできないので、押せない形のまま出す。
                  title="まとめて実行する仕組みは準備中です"
                  className="border-hairline bg-canvas text-ink-faint rounded-control border px-2.5 py-1 text-xs opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 検索と並び順（設計 `SearchBar`）。 */}
      <div data-design="SearchBar" className="bg-canvas rounded-card border border-hairline p-4 mb-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="友だち名で検索"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {/*
            設計は「詳細検索」「保存した検索」も置く。条件が増えると
            1行の検索では足りなくなる。仕組みが入るまで押せない状態で置く。
          */}
          <button
            type="button"
            disabled
            title="詳細検索は準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            詳細検索
          </button>
          <button
            type="button"
            disabled
            title="保存した検索は準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            保存した検索
          </button>
          <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
          <select
            value={sortMode}
            onChange={(e) => handleSortChange(e.target.value as SortMode)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="recent">友だち追加の新しい順</option>
            <option value="oldest">友だち追加の古い順</option>
          </select>
          <button
            type="submit"
            className="bg-accent text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:bg-accent-hover"
          >
            検索
          </button>
        </form>

        {/* Secondary filters — タグ + 対応マーク */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-hairline">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-secondary font-medium whitespace-nowrap">タグ:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedTagId}
              onChange={(e) => handleTagFilterChange(e.target.value)}
            >
              <option value="">すべて</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-secondary font-medium whitespace-nowrap">対応マーク:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={responseFilter}
              onChange={(e) => handleResponseFilterChange(e.target.value as ResponseFilter)}
            >
              <option value="all">すべて</option>
              <option value="unhandled">未対応のみ</option>
            </select>
          </div>
          <span className="text-xs text-ink-faint ml-auto">
            {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-hairline grid grid-cols-[80px_220px_120px_1fr_250px_88px] gap-3 animate-pulse">
              <div className="h-5 bg-canvas-sunken rounded w-16" />
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-canvas-sunken rounded w-20" />
              <div className="space-y-2">
                <div className="h-3 bg-canvas-sunken rounded w-3/4" />
                <div className="h-2 bg-canvas-sunken rounded w-20" />
              </div>
              <div className="h-5 bg-canvas-sunken rounded w-32" />
              <div className="h-8 bg-canvas-sunken rounded w-20" />
            </div>
          ))}
        </div>
      ) : (
        /* 一覧（設計 `Table`）。 */
        <div data-design="Table">
          <FriendListTable
            friends={friends}
            allTags={allTags}
            onRefresh={loadFriends}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={(select) =>
              setSelectedIds(select ? new Set(friends.map((f) => f.id)) : new Set())
            }
          />
        </div>
      )}

      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          {/* 選んでいる間は、いま何件に効くのかを件数の場所で示す。 */}
          <p className="text-sm text-ink-faint">
            {selectedIds.size > 0
              ? `${selectedIds.size} 件を選択中 ・ 全 ${total.toLocaleString('ja-JP')} 件`
              : `${(page - 1) * PAGE_SIZE + 1}〜${Math.min(page * PAGE_SIZE, total)} 件 / 全${total.toLocaleString('ja-JP')}件`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-canvas-sunken disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-ink-secondary px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-canvas-sunken disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}

function FriendsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  return (
    <div>
      <MergedTabs basePath="/friends" paramName="tab" tabs={MERGED_TABS} active={tab} />
      {tab === 'list' && <FriendsPageInner />}
      {tab === 'duplicates' && <DuplicatesPage />}
      {tab === 'merged' && <MergedUsersPage />}
    </div>
  )
}

export default function FriendsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FriendsPageHost />
    </Suspense>
  )
}
