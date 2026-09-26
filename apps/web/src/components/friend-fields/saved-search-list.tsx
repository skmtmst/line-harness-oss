'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import ReorderGrip from './reorder-grip'
import { mergeVisibleOrder } from './reorder-utils'
import type { SavedSearch, SavedSearchCondition, Tag } from '@line-crm/shared'
import { api, ApiError, type SavedSearchSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import KpiCard from '@/components/shared/kpi-card'
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
  const { selectedAccount } = useAccount()
  const [items, setItems] = useState<SavedSearch[]>([])
  const [summary, setSummary] = useState<SavedSearchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  /*
    並び替え・削除の失敗（#1014 ATTR-02）。読み込みの失敗は loadError。
    読み直しで消さず、次の操作か再試行の成功まで残す。
  */
  const [error, setError] = useState('')
  const [retryOrder, setRetryOrder] = useState<SavedSearch[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [conditionLabels, setConditionLabels] = useState<SavedSearchConditionLabels>({})
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null)
  const [query, setQuery] = useState('')
  const [usageFilter, setUsageFilter] = useState<SavedSearchUsageFilter>('all')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'zero' | 'unknown'>('all')
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    /*
      ATTR-02: ここで `error`（並び替え・削除の失敗）は消さない。
      保存に失敗した直後の再読込でメッセージが消え、あたかも成功した
      ように見えた。消すのは操作をやり直して成功したときだけ。
    */
    setItems([])
    setSummary(null)
    setTags([])
    setConditionLabels({})
    if (!accountId) {
      setLoading(false)
      return
    }
    /*
      #1017 PERF-14: 一覧は自分の応答が来た時点で出す。
      条件の要約に使うタグ名・マーク名・シナリオ名・項目名の補助取得は
      別に待ち、届いた時点で足す。以前は allSettled が5系統すべての
      完了を待っていたため、遅い補助が一覧の表示まで止めていた。
      補助が落ちても条件文だけが「未取得の名前」になるだけで、
      一覧そのものは使える。
    */
    void Promise.allSettled([
      api.tags.list(),
      api.supportMarks.list(accountId, { suppressFeatureDisabledEvent: true }),
      api.scenarios.list({ accountId }),
      api.friendFields.list(accountId, undefined, { suppressFeatureDisabledEvent: true }),
    ]).then(([tagResult, markResult, scenarioResult, fieldResult]) => {
      if (sequence !== loadSequence.current) return
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
    })
    try {
      const savedSearches = await api.savedSearches.list(accountId, { limit: 50 })
      if (sequence !== loadSequence.current) return
      if (!savedSearches.success) throw new Error('保存した検索を読み込めませんでした')
      setItems(savedSearches.items)
      setSummary(savedSearches.summary)
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

  /*
    アカウントが変わったら、前のアカウントの削除確認を閉じる。
    別アカウントの検索を消す確認が残ると、表示と操作対象がずれる。
  */
  useEffect(() => {
    setPendingDelete(null)
    setError('')
    setRetryOrder(null)
  }, [accountId])

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
      setError(reason instanceof ApiError ? reason.message : '削除に失敗しました。通信を確かめて、もう一度お試しください。')
    }
  }

  /*
    並び替えは /api/saved-searches/reorder へ「動かせる行だけの新しい順」を
    1回で渡す（#1014 ATTR-02/03）。

    以前は行ごとの PATCH で順位を書いていた。他人が作った検索は404で
    断られるので途中までしか反映されず、絞り込みで隠れた行は全て末尾へ
    送られていた（`?? 9999` のソート）。サーバーは動かせる行だけを
    原子的に入れ替え、隠れた行と他人が作った検索の位置を保つ。
  */
  const applyOrder = async (next: SavedSearch[]) => {
    if (!accountId) return
    const account = accountId
    const previous = items
    setItems(next)
    setError('')
    setRetryOrder(null)
    try {
      const res = await api.savedSearches.reorder(account, next.map((search) => search.id))
      if (!res.success) throw new Error(res.error)
      void load()
    } catch (reason) {
      // 失敗した並びは保存済みと見せず元に戻す。理由と再試行は次の操作まで残す。
      setItems(previous)
      setError(reason instanceof ApiError ? `並び順を保存できませんでした（${reason.message}）` : '並び順を保存できませんでした')
      setRetryOrder(next)
    }
  }

  /**
   * つまみにフォーカスして ↑/↓ で1つ動かす（N-049）。
   * 絞り込み中は見えている行だけを入れ替え、隠れた行の位置を保つ。
   */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = visible.map((search) => search.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((item) => item.id === i)).filter(Boolean) as SavedSearch[]
    await applyOrder(mergeVisibleOrder(items, visibleNext))
  }

  const ready = Boolean(accountId) && !loading && !loadError
  const fallbackKpis = savedSearchKpiValues(items, ready)
  const kpis = summary ?? fallbackKpis
  const visible = filterSavedSearches(items, query, usageFilter).filter((item) => {
    /*
      ATTR-08: 人数が `null` / `undefined`（未集計・集計失敗）は
      「0人」にも「1人以上」にも数えない。数字の絞り込みは数字が
      入っている行だけに掛ける。以前は null が全フィルターに素通りして、
      0人の一覧に未集計が混ざっていた。
    */
    const count = item.matchCount
    const uncounted = count === null || count === undefined
    // 「未集計」を選んだときだけ未集計の行を出す。数字の絞り込みには混ぜない。
    if (matchFilter === 'unknown') return uncounted
    if (uncounted) return matchFilter === 'all'
    return matchFilter === 'zero' ? count === 0 : count > 0
  })

  return (
    <div data-design-node="QKx8Q">
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard title="保存した条件" value={kpis.total} unit="件" detail="上限50件" loading={loading} variant="v6" />
        <KpiCard title="配信で使用中" value={kpis.usedInBroadcasts} unit="件" detail="変更時は影響確認" loading={loading} variant="v6" />
        <KpiCard title="該当者0人" value={kpis.zeroMatches} unit="件" detail="条件の見直し候補" loading={loading} variant="v6" />
        <KpiCard title="今月の呼び出し" value={kpis.callsThisMonth} unit="回" detail={kpis.callsThisMonth === null ? '呼び出し記録は未接続' : '配信・自動処理'} loading={loading} variant="v6" />
      </div>

      {/*
        ATTR-23: 細かい仕様（AND/OR・演算子の数・軸の数）はここに並べず、
        「どこから作るか」を先に伝える。条件の作り方は友だち一覧側に揃える。
      */}
      <p className="border-hairline text-ink-secondary mb-4 rounded-control border bg-canvas px-3 py-2 text-sm">
        友だち一覧の絞り込みを「この条件を保存」でここに保存します。配信や自動処理からも同じ条件を呼び出せます。
      </p>

      {!accountId && (
        <div className="bg-info-bg text-info mb-4 rounded-lg p-4 text-sm">
          上部でLINE公式アカウントを選んでください。
        </div>
      )}

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
          {retryOrder ? (
            <button
              type="button"
              className="ml-2 font-semibold underline underline-offset-2"
              onClick={() => {
                const next = retryOrder
                setRetryOrder(null)
                if (next) void applyOrder(next)
              }}
            >
              再試行
            </button>
          ) : null}
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
          className="h-9 w-40 rounded-control border border-hairline bg-canvas px-3 text-label"
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
          {/* ATTR-08: 未集計・集計失敗は「0人」とは別の状態として探せる。 */}
          <option value="unknown">未集計</option>
        </select>
        <span className="flex-1" />
        {/*
          作る導線はタブの右に1個だけ（#1014 ATTR-22）。
          「保存条件からコピー」は一覧内の第二導線だったので、ここからは外す。
        */}
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
        /*
          ATTR-23: 0件のときは「保存条件からコピー」ではなく、
          最初の1件を作る本筋の導線（友だち一覧の絞り込み → この条件を保存）
          へ案内する。
        */
        <ListState
          kind="empty"
          title="まだ保存した検索がありません"
          description="友だち一覧で条件を絞り、「この条件を保存」を押すとここに追加されます。"
          action={<Button href="/friends" variant="primary">友だち一覧で条件を作る</Button>}
        />
      ) : visible.length === 0 ? (
        <p className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          条件に合う保存した検索はありません。条件名か使用先を変えてください。
        </p>
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
          {/*
            960px以上は表（#1014 ATTR-15）。該当・共有・操作は短い言葉なので
            幅を絞り、はみ出た「条件の要約」と「更新者・日時」に回す。
            それ未満は縦に重ねたカード（ATTR-14）。
          */}
          <table className="hidden w-full table-fixed text-sm md:table">
            <thead className="border-b border-hairline bg-canvas-sunken text-[11px] text-ink-faint">
              <TableHeadRow>
                <Th className="w-[16%] px-3 py-3">条件名 ／ 所有・範囲・参照・版</Th>
                <Th className="w-1/4 px-3 py-3">条件の要約</Th>
                <Th className="w-[7%] px-3 py-3">該当</Th>
                <Th className="w-[8%] px-3 py-3">共有</Th>
                <Th className="w-1/6 px-3 py-3">使用先</Th>
                <Th className="w-[12%] px-3 py-3">更新者・日時</Th>
                <Th className="w-[140px] px-3 py-3">操作</Th>
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
                    {/* つまみは装飾ではなく ↑/↓ で並び替えられる（N-049）。 */}
                    <ReorderGrip label={search.name} onMove={(direction) => void keyboardMove(search.id, direction)} />
                  {search.lineAccountId ? (
                    /*
                      ATTR-24: 長い名前は省略するだけでなく、ホバー（title）と
                      読み上げ（aria-label）で全文を伝える。
                      「条件を確認・編集」だけだと、どの条件か分からない。
                    */
                    <Link
                      href={`/tags/searches/edit?id=${encodeURIComponent(search.id)}`}
                      className="truncate font-bold text-action hover:underline"
                      title={search.name}
                      aria-label={`${search.name} を編集`}
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
                  <p className="mt-1 truncate text-[11px] text-ink-faint" title={`${search.isShared ? '全員' : '自分だけ'}・${selectedAccount?.name ?? search.lineAccountId ?? '対象未設定'}・ライブ参照・v${search.revision ?? 1}`}>
                    {search.isShared ? '全員' : '自分だけ'}・{selectedAccount?.name ?? search.lineAccountId ?? '対象未設定'}・ライブ参照・v{search.revision ?? 1}
                  </p>
                </td>
                <td className="px-3 py-3 align-top text-xs leading-5 text-ink-secondary">
                  {all.length > 0 ? <p title={all.join('・')}>{all.join('・')}・AND</p> : null}
                  {any.length > 0 ? <p title={any.join('・')}><span className="font-semibold">いずれか1つ以上：</span>{any.join('・')}・OR</p> : null}
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
                  <p>{search.updatedBy ?? search.createdBy ?? '—'}</p>
                  <p className="text-ink-faint">{new Date(search.updatedAt ?? search.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
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
          {/*
            960px未満は縦に重ねたカード（#1014 ATTR-14/15）。
            名前・人数・使用先・操作を同じカード内に収める。
          */}
          <ul className="divide-y divide-hairline md:hidden">
            {visible.map((search) => {
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
              const { all, any } = splitConditions(search.conditions, tags, conditionLabels)
              return (
                <li key={search.id} className="px-3 py-3">
                  <div className="flex items-start gap-2">
                    <span className="pt-1"><ReorderGrip label={search.name} onMove={(direction) => void keyboardMove(search.id, direction)} /></span>
                    <div className="min-w-0 flex-1">
                      {search.lineAccountId ? (
                        <Link href={`/tags/searches/edit?id=${encodeURIComponent(search.id)}`} className="block truncate font-bold text-action hover:underline" title={search.name} aria-label={`${search.name} を編集`}>
                          {search.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-bold text-ink" title={search.name}>{search.name}</span>
                      )}
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {search.isShared ? '全員' : '自分だけ'}・{selectedAccount?.name ?? search.lineAccountId ?? '対象未設定'}・v{search.revision ?? 1}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink-secondary">
                        {all.length > 0 ? all.join('・') : null}
                        {any.length > 0 ? `${all.length > 0 ? '・' : ''}いずれか：${any.join('・')}` : null}
                        {all.length === 0 && any.length === 0 ? '指定なし' : null}
                      </p>
                      <p className="mt-1 text-xs text-ink-faint">
                        {search.matchCount === null || search.matchCount === undefined ? '該当 —' : `該当 ${search.matchCount.toLocaleString('ja-JP')}人`}・{search.usedIn === undefined ? '使用先 —' : search.usedIn.length === 0 ? '未使用' : search.usedIn.map((usage) => `${USAGE_KIND_LABELS[usage.kind]}「${usage.name}」`).join('・')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-1">
                      {search.lineAccountId ? <Link href={`/friends?savedSearch=${search.id}`} className="whitespace-nowrap text-xs font-semibold text-action hover:underline">一覧へ</Link> : null}
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
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/*
        読めていないときに「0 / 50 件」と書かない。**まだ余裕がある**と
        読めてしまう。数が言えるのは一覧を読めたときだけ。
      */}
      <p className="text-ink-faint mt-3 text-xs">
        {ready
          ? `保存できるのは 50 件までです。${summary?.total ?? items.length} / 50 件。`
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
