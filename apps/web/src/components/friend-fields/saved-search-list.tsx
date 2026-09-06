'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { GripVertical, Trash2 } from 'lucide-react'
import type { SavedSearch, SavedSearchCondition, Tag } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { describeSavedCondition, type SavedSearchConditionLabels } from '@/components/friends/saved-search-utils'
import {
  filterSavedSearches,
  savedSearchKpiValues,
  type SavedSearchUsageFilter,
} from './saved-search-kpis'

function isSavedSearchCondition(item: unknown): item is SavedSearchCondition {
  if (!item || typeof item !== 'object') return false
  const value = item as Partial<SavedSearchCondition>
  return typeof value.kind === 'string' && typeof value.op === 'string'
}

/** 保存した条件の中身。all（かつ）と any（または）に分けて返す。 */
function splitConditions(
  conditions: unknown,
  tags: Tag[],
  labels: SavedSearchConditionLabels,
): { all: string[]; any: string[]; note: string | null } {
  const c = conditions as { all?: unknown[]; any?: unknown[]; visibility?: string } | null
  if (!c) return { all: [], any: [], note: null }
  const note =
    c.visibility === 'hidden_only'
      ? '非表示の人のみ'
      : c.visibility === 'all'
        ? '表示状態を問わない'
        : null
  return {
    all: (c.all ?? []).map((item) => isSavedSearchCondition(item) ? describeSavedCondition(item, tags, labels) : '条件を確認できません'),
    any: (c.any ?? []).map((item) => isSavedSearchCondition(item) ? describeSavedCondition(item, tags, labels) : '条件を確認できません'),
    note,
  }
}

const USAGE_KIND_LABELS = {
  broadcast: '一斉配信',
  automation: 'オートメーション',
  scenario: 'シナリオ',
  other: 'そのほか',
} as const

/**
 * 保存した検索の一覧。
 *
 * ここは管理だけ。条件を作るのは友だち一覧の絞り込みで、そこから
 * 「この条件を保存」で増える。条件を組む画面を2つ持つと、必ず食い違う。
 */
export default function SavedSearchList({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [conditionLabels, setConditionLabels] = useState<SavedSearchConditionLabels>({})
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null)
  const [query, setQuery] = useState('')
  const [usageFilter, setUsageFilter] = useState<SavedSearchUsageFilter>('all')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'zero'>('all')
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    setError('')
    setItems([])
    setTags([])
    setConditionLabels({})
    try {
      if (!accountId) return
      const [savedSearches, tagResult, markResult, scenarioResult, fieldResult] = await Promise.allSettled([
        api.savedSearches.list(accountId),
        api.tags.list(),
        api.supportMarks.list(accountId),
        api.scenarios.list({ accountId }),
        api.friendFields.list(accountId),
      ])
      if (sequence !== loadSequence.current) return
      if (savedSearches.status === 'rejected') throw savedSearches.reason
      if (!savedSearches.value.success) throw new Error('保存した検索を読み込めませんでした')
      setItems(savedSearches.value.data)
      if (tagResult.status === 'fulfilled' && tagResult.value.success) setTags(tagResult.value.data)
      setConditionLabels({
        marks: markResult.status === 'fulfilled' && markResult.value.success
          ? Object.fromEntries(markResult.value.data.map((mark) => [mark.id, mark.name]))
          : {},
        scenarios: scenarioResult.status === 'fulfilled' && scenarioResult.value.success
          ? Object.fromEntries(scenarioResult.value.data.map((scenario) => [scenario.id, scenario.name]))
          : {},
        fields: fieldResult.status === 'fulfilled' && fieldResult.value.success
          ? Object.fromEntries(fieldResult.value.data.map((field) => [field.fieldKey, field.name]))
          : {},
      })
    } catch (reason) {
      if (sequence === loadSequence.current) {
        setLoadError(reason instanceof ApiError ? reason.message : '保存した検索を読み込めませんでした')
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const remove = (search: SavedSearch) => {
    setPendingDelete(search)
  }

  const confirmRemove = async (search: SavedSearch) => {
    setError('')
    try {
      if (!accountId) return
      await api.savedSearches.delete(search.id, accountId)
      void load()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '削除に失敗しました')
    }
  }

  const ready = Boolean(accountId) && !loading && !loadError
  const kpis = savedSearchKpiValues(items, ready)
  const visible = filterSavedSearches(items, query, usageFilter).filter((item) => {
    if (matchFilter === 'all' || item.matchCount === null || item.matchCount === undefined) return true
    return matchFilter === 'zero' ? item.matchCount === 0 : item.matchCount > 0
  })

  return (
    <div data-design-node="QKx8Q">
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard title="保存した条件" value={kpis.total} unit="件" detail="上限50件" loading={loading} variant="v6" />
        <SummaryCard title="配信で使用中" value={kpis.usedInBroadcasts} unit="件" detail="変更時は影響確認" loading={loading} variant="v6" />
        <SummaryCard title="該当者0人" value={kpis.zeroMatches} unit="件" detail="条件の見直し候補" loading={loading} variant="v6" />
        <SummaryCard title="今月の呼び出し" value={kpis.callsThisMonth} unit="回" detail="呼び出し記録は未接続" loading={loading} variant="v6" />
      </div>

      <p className="border-hairline text-ink-secondary mb-4 rounded-control border bg-canvas px-3 py-2 text-sm">
        AND群とOR群、友だち情報の10演算子を組み合わせ、保存した条件からコピーして再利用します。軸は呼び出し元で変わります。
      </p>

      {!accountId && (
        <div className="bg-info-bg text-info mb-4 rounded-lg p-4 text-sm">
          上部でLINE公式アカウントを選んでください。
        </div>
      )}

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {/*
        設計 `QKx8Q` のツールバー。どちらも読み込んだ一覧の中だけで効く。
        新しい口は要らないので、条件が増えたときに探せない状態を先に直す。
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="条件名で検索"
          aria-label="条件名で検索"
          className="h-9 w-40 rounded-control border border-hairline bg-canvas px-3 text-label outline-none focus:border-accent"
        />
        <select
          value={usageFilter}
          onChange={(event) => setUsageFilter(event.target.value as SavedSearchUsageFilter)}
          aria-label="使用先"
          className="v6-select h-9 w-36 rounded-control border border-hairline bg-canvas pl-3 text-label font-semibold text-ink"
        >
          <option value="all">使用先：すべて</option>
          <option value="used">使用中</option>
          <option value="unused">未使用</option>
        </select>
        <select
          value={matchFilter}
          onChange={(event) => setMatchFilter(event.target.value as typeof matchFilter)}
          aria-label="該当人数"
          className="v6-select h-9 w-36 rounded-control border border-hairline bg-canvas pl-3 text-label font-semibold text-ink"
        >
          <option value="all">該当人数：すべて</option>
          <option value="matched">1人以上</option>
          <option value="zero">0人</option>
        </select>
        <span className="flex-1" />
        <Button href="/friends" variant="primary">保存条件からコピー</Button>
        {ready ? (
          <span className="text-caption tabular-nums text-ink-faint">
            {visible.length === items.length
              ? `${items.length}件`
              : `${visible.length} / ${items.length}件`}
          </span>
        ) : null}
      </div>

      {/* 設計 `QKx8Q` の7列。一覧だけで条件・人数・使用先を判断できる。 */}
      {loading ? (
        <ListState kind="loading" />
      ) : !accountId ? null
      : loadError ? (
        <ListState
          kind="error"
          description={loadError}
          action={<Button type="button" onClick={() => void load()}>保存した検索を再読み込み</Button>}
        />
      ) : items.length === 0 ? (
        <p className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          保存した検索はまだありません。
          <Link href="/friends" className="text-accent ml-1 hover:underline">
            友だち一覧へ
          </Link>
        </p>
      ) : visible.length === 0 ? (
        <p className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          条件に合う保存した検索はありません。条件名か使用先を変えてください。
        </p>
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-hairline bg-canvas-sunken text-[11px] text-ink-faint">
              <TableHeadRow>
                <Th className="w-[16%] px-3 py-3">条件名</Th>
                <Th className="w-[27%] px-3 py-3">条件の要約</Th>
                <Th className="w-[8%] px-3 py-3">該当</Th>
                <Th className="w-[8%] px-3 py-3">共有</Th>
                <Th className="w-[16%] px-3 py-3">使用先</Th>
                <Th className="w-[15%] px-3 py-3">作成者・日時</Th>
                <Th className="w-[10%] px-3 py-3">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-y divide-hairline">
          {visible.map((search) => {
            const { all, any, note } = splitConditions(search.conditions, tags, conditionLabels)
            const deleteDisabled = !search.lineAccountId || search.canDelete !== true
            const deleteTitle = !search.lineAccountId
              ? '管理者が対象アカウントを割り当てるまで変更できません'
              : search.usedIn === undefined
                ? '使用先を確認できないため削除できません'
              : search.usedIn.length > 0
                ? `使用中のため削除できません（${search.usedIn?.length ?? 0}件）`
              : search.canDelete === true
                ? '保存した検索を削除'
                : '削除できるか確認できません'
            return (
              <tr
                key={search.id}
                className="hover:bg-canvas-sunken"
              >
                <td className="px-3 py-3 align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    <GripVertical aria-hidden="true" size={15} className="shrink-0 text-ink-faint" />
                  {search.lineAccountId ? (
                    <Link
                      href={`/tags/searches/edit?id=${encodeURIComponent(search.id)}`}
                      className="truncate font-bold text-action hover:underline"
                      title="条件を確認・編集"
                    >
                      {search.name}
                    </Link>
                  ) : (
                    <span className="truncate font-bold text-ink" title={search.name}>{search.name}</span>
                  )}
                  {!search.lineAccountId && (
                    <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-[10px] text-warning">
                      対象アカウント未割り当て
                    </span>
                  )}
                  </div>
                </td>
                <td className="px-3 py-3 align-top text-xs leading-5 text-ink-secondary">
                  {all.length > 0 ? <p title={all.join('・')}>{all.join('・')}・AND</p> : null}
                  {any.length > 0 ? <p title={any.join('・')}>{any.join('・')}・OR</p> : null}
                  {all.length === 0 && any.length === 0 ? <p>指定なし</p> : null}
                  {note ? <p className="text-ink-faint">{note}</p> : null}
                </td>
                <td className="px-3 py-3 align-top tabular-nums text-ink" title={search.matchCountError ?? undefined}>
                  {search.matchCount === null || search.matchCount === undefined ? '—' : `${search.matchCount.toLocaleString('ja-JP')}人`}
                </td>
                <td className="px-3 py-3 align-top">
                  <span className={`rounded-pill px-2 py-0.5 text-[11px] ${search.isShared ? 'bg-action-soft text-action' : 'bg-canvas-sunken text-ink-secondary'}`}>
                    {search.isShared ? '全員' : '自分だけ'}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-xs text-ink">
                  {search.usedIn === undefined ? '—' : search.usedIn.length === 0 ? '未使用' : search.usedIn.map((usage) => `${USAGE_KIND_LABELS[usage.kind]}「${usage.name}」`).join('・')}
                </td>
                <td className="px-3 py-3 align-top text-xs text-ink">
                  <p>{search.createdBy ?? '—'}</p>
                  <p className="text-ink-faint">{new Date(search.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex items-center gap-2">
                    {search.lineAccountId ? <Link href={`/friends?savedSearch=${search.id}`} className="whitespace-nowrap text-xs font-semibold text-action hover:underline">友だち一覧へ</Link> : null}
                  <button
                    onClick={() => remove(search)}
                    disabled={deleteDisabled}
                    aria-label={`${search.name}を削除`}
                    title={deleteTitle}
                    className="rounded-md p-1 text-danger hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                  </div>
                </td>
              </tr>
            )
          })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        読めていないときに「0 / 50 件」と書かない。**まだ余裕がある**と
        読めてしまう。数が言えるのは一覧を読めたときだけ。
      */}
      <p className="text-ink-faint mt-3 text-xs">
        {ready
          ? `保存できるのは 50 件までです。${items.length} / 50 件。`
          : '保存できるのは 50 件までです。いまの件数は読み込めていません。'}
      </p>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`保存した検索「${pendingDelete?.name ?? ''}」を削除しますか？`}
        description="使用先が無いことをサーバーで確認済みです。保存した絞り込み条件だけを削除し、友だち自体は削除しません。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) void confirmRemove(target)
        }}
      />
    </div>
  )
}
