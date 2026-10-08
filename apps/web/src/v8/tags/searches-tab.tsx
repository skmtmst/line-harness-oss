'use client'

/*
 * ★V8 タグ「保存した検索」タブ（Pencil `IWnYX`）。
 *
 * ここは管理だけ。条件を作るのは友だち一覧の絞り込みで、「この条件を保存」で増える。
 * 動き（読み込み・数の帯・絞り込み・並べ替え・削除・行の詳細パネル・名前のその場の直し・右クリック）は
 * 今の V8 タブ（app/tags/searches-v8.tsx）から写した。見た目は絵に合わせた：
 * 表は「条件名・内容／該当／共有／使っている所／更新／友だち一覧へ／…」。つまみの列は無く、
 * 並べ替えは行の「…」の「上へ動かす・下へ動かす」（つまみで ↑↓ と同じ口）。
 * 絵の下の段のとおり、行の「…」に「複製して保存」を足した（同じ条件で新しく保存する）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CalendarClock, Filter, Info, Send, Users } from 'lucide-react'
import type { SavedSearch, Tag } from '@line-crm/shared'
import { api, ApiError, type SavedSearchSummary } from '@/lib/api'
import { ListPageBody } from '@/components/templates'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import DetailPanel, { useDetailPanelUrl } from '@/components/shared/detail-panel'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import InlineEdit from '@/components/shared/inline-edit'
import { withViewTransition } from '@/components/shared/view-transition'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { notifyToast } from '@/components/shared/toast'
import PageSizeSelect from '@/components/ui/page-size-select'
import { mergeVisibleOrder } from '@/components/friend-fields/reorder-utils'
import { splitConditions } from '@/components/friend-fields/saved-search-list'
import type { SavedSearchConditionLabels } from '@/components/friends/saved-search-utils'
import { filterSavedSearches, savedSearchKpiValues, type SavedSearchUsageFilter } from '@/components/friend-fields/saved-search-kpis'
import { formatDay, formatNumber } from '@/lib/format'
import styles from './list.module.css'

const PAGE_SIZES = [10, 20, 50]
const MAX_SAVED = 50

/* 使っている所の種類（絵の言葉）。 */
const USAGE_WORDS: Record<string, string> = {
  broadcast: '一斉配信',
  automation: '自動処理',
  scenario: 'シナリオ',
  other: 'そのほか',
}

/** 条件の要約（絵：「タグ「VIP」を含む かつ タグ「未契約」を含む」）。 */
export function conditionSummary(split: { all: string[]; any: string[]; note: string | null }): string {
  const all = split.all.join(' かつ ')
  const any = split.any.join(' または ')
  const main = all && any ? `${all} かつ （${any}）` : all || any || '指定なし'
  return split.note ? `${main}・${split.note}` : main
}

/** 使っている所（1件は「一斉配信「秋の案内」」、複数は「一斉配信 2・自動処理 1」、なしは「なし」）。 */
export function usageSummary(usedIn: SavedSearch['usedIn']): string {
  if (usedIn === undefined) return '—'
  if (usedIn.length === 0) return 'なし'
  if (usedIn.length === 1) return `${USAGE_WORDS[usedIn[0].kind] ?? 'そのほか'}「${usedIn[0].name}」`
  const counts = new Map<string, number>()
  for (const usage of usedIn) {
    const word = USAGE_WORDS[usage.kind] ?? 'そのほか'
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts].map(([word, count]) => `${word} ${count}`).join('・')
}

/** 更新（「Kenta・8月20日」）。 */
function updatedText(search: SavedSearch): string {
  const who = search.updatedBy ?? search.createdBy ?? '—'
  const day = formatDay(search.updatedAt ?? search.createdAt).replace(/（.）$/, '')
  return `${who}・${day}`
}

export default function SearchesTab({ accountId, canEdit }: { accountId: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<SavedSearch[]>([])
  const [summary, setSummary] = useState<SavedSearchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  // 並び替え・削除・複製の失敗。読み込みの失敗は loadError。
  const [error, setError] = useState('')
  const [retryOrder, setRetryOrder] = useState<SavedSearch[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [conditionLabels, setConditionLabels] = useState<SavedSearchConditionLabels>({})
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null)
  const [query, setQuery] = useState('')
  const [usageFilter, setUsageFilter] = useState<SavedSearchUsageFilter>('all')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'zero' | 'unknown'>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 行の詳細パネル。URL に ?search=<id> を残す。 */
  const [activeSearchId, setActiveSearchId] = useDetailPanelUrl('search')
  const openSearchDetail = (id: string) => withViewTransition(() => setActiveSearchId(id))
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    setForbidden(false)
    setItems([])
    setSummary(null)
    setTags([])
    setConditionLabels({})
    if (!accountId) {
      setLoading(false)
      return
    }
    /* 補助取得（タグ名・マーク名・シナリオ名・項目名）は一覧とは別に待つ（PERF-14）。 */
    void Promise.allSettled([
      api.tags.list({ accountId }),
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
      const savedSearches = await api.savedSearches.list(accountId, { limit: MAX_SAVED })
      if (sequence !== loadSequence.current) return
      if (!savedSearches.success) throw new Error('保存した検索を読み込めませんでした')
      setItems(savedSearches.items)
      setSummary(savedSearches.summary)
    } catch (reason) {
      if (sequence === loadSequence.current) {
        if (reason instanceof ApiError && reason.status === 403) setForbidden(true)
        else setLoadError(reason instanceof ApiError ? reason.message : '保存した検索を読み込めませんでした')
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [accountId])
  useEffect(() => { void load() }, [load])

  /* アカウントが変わったら、前のアカウントの削除確認を閉じる。 */
  useEffect(() => {
    setPendingDelete(null)
    setError('')
    setRetryOrder(null)
    setPage(1)
    setOpenMenuId(null)
  }, [accountId])

  const confirmRemove = async (search: SavedSearch) => {
    setError('')
    try {
      if (!accountId) return
      await api.savedSearches.delete(search.id, accountId)
      setPendingDelete(null)
      void load()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '削除に失敗しました。通信を確かめて、もう一度お試しください。')
    }
  }

  /* 複製して保存：同じ条件・共有範囲で、名前に「のコピー」を付けて新しく保存する。 */
  const duplicate = async (search: SavedSearch) => {
    if (!search.lineAccountId) return
    setError('')
    try {
      const res = await api.savedSearches.create({
        name: `${search.name}のコピー`,
        accountId: search.lineAccountId,
        conditions: search.conditions,
        isShared: search.isShared,
      })
      if (!res.success) throw new Error(res.error)
      notifyToast(`「${search.name}のコピー」を保存しました`)
      void load()
    } catch (reason) {
      setError(reason instanceof ApiError ? `複製できませんでした（${reason.message}）` : '複製できませんでした')
    }
  }

  /* 並び替えは /api/saved-searches/reorder へ1回で渡す（ATTR-02/03）。 */
  const applyOrder = async (next: SavedSearch[]) => {
    if (!accountId) return
    const previous = items
    setItems(next)
    setError('')
    setRetryOrder(null)
    try {
      const res = await api.savedSearches.reorder(accountId, next.map((search) => search.id))
      if (!res.success) throw new Error(res.error)
      void load()
    } catch (reason) {
      setItems(previous)
      const message = reason instanceof ApiError ? `並び順を保存できませんでした（${reason.message}）` : '並び順を保存できませんでした'
      setError(message)
      setRetryOrder(next)
      notifyToast(message, { tone: 'error', actionLabel: 'もう一度', onAction: () => { void applyOrder(next) } })
    }
  }

  const ready = Boolean(accountId) && !loading && !loadError && !forbidden
  const kpis = summary ?? savedSearchKpiValues(items, ready)

  const filteredList = filterSavedSearches(items, query, usageFilter).filter((item) => {
    /* 未集計（null）は「0人」にも「1人以上」にも数えない（ATTR-08）。 */
    const count = item.matchCount
    const uncounted = count === null || count === undefined
    if (matchFilter === 'unknown') return uncounted
    if (uncounted) return matchFilter === 'all'
    if (matchFilter === 'all') return true
    return matchFilter === 'zero' ? count === 0 : count > 0
  })
  const pages = Math.max(1, Math.ceil(filteredList.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filteredList.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const activeSearch = items.find((item) => item.id === activeSearchId) ?? null
  const activeSearchIndex = visible.findIndex((item) => item.id === activeSearchId)
  useEffect(() => setPage(1), [query, usageFilter, matchFilter, pageSize])

  /** 1つ上・下へ動かす（見えている並びの中で）。 */
  const moveBy = async (id: string, direction: -1 | 1) => {
    const order = filteredList.map((search) => search.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((item) => item.id === i)).filter(Boolean) as SavedSearch[]
    await applyOrder(mergeVisibleOrder(items, visibleNext))
  }

  /* 行の「…」と右クリックは同じ中身。閲覧のみは変える操作を出さない（2026-10-06 オーナー）。 */
  const rowMenuItems = (search: SavedSearch): ActionMenuItem[] => {
    const list: ActionMenuItem[] = []
    const index = filteredList.findIndex((item) => item.id === search.id)
    if (search.lineAccountId) {
      list.push({ id: 'open', label: '友だち一覧へ', external: true, onSelect: () => router.push(`/friends?savedSearch=${search.id}`) })
      if (canEdit) {
        list.push({ id: 'edit', label: '編集', external: true, onSelect: () => router.push(`/tags/searches/edit?id=${encodeURIComponent(search.id)}`) })
        list.push({
          id: 'duplicate',
          label: '複製して保存',
          disabled: items.length >= MAX_SAVED,
          disabledReason: items.length >= MAX_SAVED ? `保存は最大 ${MAX_SAVED} 件です` : undefined,
          onSelect: () => void duplicate(search),
        })
      }
    }
    if (canEdit) {
      list.push({ id: 'up', label: '上へ動かす', dividerBefore: list.length > 0, disabled: index <= 0, onSelect: () => void moveBy(search.id, -1) })
      list.push({ id: 'down', label: '下へ動かす', disabled: index < 0 || index >= filteredList.length - 1, onSelect: () => void moveBy(search.id, 1) })
      const deleteDisabled = !search.lineAccountId || search.canDelete !== true
      const deleteReason = !search.lineAccountId
        ? '管理者が対象アカウントを割り当てるまで変更できません'
        : search.usedIn === undefined
          ? '使用先を確認できないため削除できません'
          : (search.usedIn?.length ?? 0) > 0
            ? `使用中のため削除できません（${search.usedIn?.length ?? 0}件）`
            : '削除できるか確認できません'
      list.push({
        id: 'delete',
        label: '削除する',
        tone: 'danger',
        dividerBefore: true,
        disabled: deleteDisabled,
        disabledReason: deleteDisabled ? deleteReason : undefined,
        onSelect: () => setPendingDelete(search),
      })
    }
    return list
  }
  const searchContextItems = (search: SavedSearch): ContextMenuItem[] =>
    rowMenuItems(search).map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      onSelect: () => item.onSelect(),
    }))

  const sharedCount = items.filter((item) => item.isShared).length
  const kpiCards = [
    { title: '保存した条件', icon: Filter, value: kpis.total, unit: '件', detail: ready ? `自分 ${items.length - sharedCount}・共有 ${sharedCount}` : '—' },
    { title: '配信で使っている', icon: Send, value: kpis.usedInBroadcasts, unit: '件', detail: '一斉配信・自動処理' },
    { title: '該当なし', icon: Users, value: kpis.zeroMatches, unit: '件', detail: '条件が古いかも' },
    { title: '今月の利用', icon: CalendarClock, value: kpis.callsThisMonth, unit: '回', detail: kpis.callsThisMonth === null ? '利用の記録は未接続' : '友だち一覧で開いた回数' },
  ]

  const filterActive = Boolean(query || usageFilter !== 'all' || matchFilter !== 'all')

  const table = !accountId ? (
    <div className={styles.stateCard}>
      <p className={styles.stateTitle}>上部でLINE公式アカウントを選んでください</p>
    </div>
  ) : forbidden ? (
    <div className={styles.stateCard}>
      <AlertCircle className={styles.stateIconError} aria-hidden="true" />
      <p className={styles.stateTitle}>保存した検索を見る権限がありません</p>
      <p className={styles.stateDesc}>オーナーか管理者に確認してください。</p>
    </div>
  ) : loadError ? (
    <div className={styles.stateCard}>
      <AlertCircle className={styles.stateIconError} aria-hidden="true" />
      <p className={styles.stateTitle}>保存した検索を読み込めませんでした</p>
      <p className={styles.stateDesc}>{loadError}</p>
      <Button type="button" onClick={() => void load()}>もう一度試す</Button>
    </div>
  ) : ready && items.length === 0 ? (
    <div className={styles.stateCard}>
      <Filter className={styles.stateIcon} aria-hidden="true" />
      <p className={styles.stateTitle}>まだ保存した検索はありません</p>
      <p className={styles.stateDesc}>友だち一覧で条件を絞り、「この条件を保存」を押すとここに追加されます。</p>
      <Button href="/friends" variant="primary">友だち一覧で条件を作る</Button>
    </div>
  ) : ready && visible.length === 0 ? (
    <div className={styles.stateCard}>
      <p className={styles.stateTitle}>条件に合うものはありません</p>
      <p className={styles.stateDesc}>検索や絞り込みを外すと、すべて出ます</p>
      {filterActive ? <Button type="button" onClick={() => { setQuery(''); setUsageFilter('all'); setMatchFilter('all') }}>条件を外す</Button> : null}
    </div>
  ) : (
    <DelayedSkeleton loading={loading} skeleton={<div className={styles.skeleton} aria-busy="true" />}>
      <DataTable className={styles.table}>
        <thead>
          <TableHeadRow>
            <Th className={styles.searchColName}>条件名・内容</Th>
            <Th className={styles.searchColCount}>該当</Th>
            <Th className={styles.searchColShare}>共有</Th>
            <Th className={styles.searchColUsage}>使っている所</Th>
            <Th className={styles.searchColUpdated}>更新</Th>
            <Th className={styles.searchColOpen}><span className="sr-only">友だち一覧へ</span></Th>
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {visible.map((search) => {
            const summaryText = conditionSummary(splitConditions(search.conditions, tags, conditionLabels))
            const editHref = search.lineAccountId && canEdit ? `/tags/searches/edit?id=${encodeURIComponent(search.id)}` : null
            const usage = usageSummary(search.usedIn)
            return (
              <Tr
                interactive
                key={search.id}
                className={`${styles.row} ${styles.searchRow}`}
                tabIndex={0}
                onClick={() => openSearchDetail(search.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    openSearchDetail(search.id)
                  }
                }}
              >
                <Td className={styles.searchColName}>
                  <ContextMenu label={`保存した検索「${search.name}」の操作`} items={searchContextItems(search)}>
                    <div className={styles.nameRow}>
                      {editHref ? (
                        <Link href={editHref} className={styles.name} title={search.name} onClick={(event) => event.stopPropagation()}>
                          {search.name}
                        </Link>
                      ) : (
                        <span className={styles.name} title={search.name}>{search.name}</span>
                      )}
                      {!search.lineAccountId ? (
                        <span className={`${styles.miniBadge} ${styles.miniBadgeWarn}`}>対象アカウント未割り当て</span>
                      ) : null}
                    </div>
                    <p className={styles.sub} title={summaryText}>{summaryText}</p>
                  </ContextMenu>
                </Td>
                <Td className={styles.searchColCount} onClick={(event) => event.stopPropagation()}>
                  <span className={styles.cellText} title={search.matchCountError ?? undefined}>
                    {search.matchCount !== null && search.matchCount !== undefined ? `${formatNumber(search.matchCount)}人` : '—'}
                  </span>
                </Td>
                <Td className={styles.searchColShare}><span className={styles.cellText}>{search.isShared ? '全員' : '自分だけ'}</span></Td>
                <Td className={styles.searchColUsage}><span className={styles.cellText} title={usage}>{usage}</span></Td>
                <Td className={styles.searchColUpdated}><span className={styles.cellText} title={updatedText(search)}>{updatedText(search)}</span></Td>
                <Td className={styles.searchColOpen} onClick={(event) => event.stopPropagation()}>
                  {search.lineAccountId ? (
                    <Button href={`/friends?savedSearch=${search.id}`} aria-label={`「${search.name}」で友だち一覧を開く`}>
                      <Users size={15} aria-hidden="true" />友だち一覧へ
                    </Button>
                  ) : null}
                </Td>
                <Td className={styles.colMenu} onClick={(event) => event.stopPropagation()}>
                  <span className={styles.menuAnchor}>
                    <RowMenu
                      className={styles.menuButton}
                      label={`保存した検索「${search.name}」の操作`}
                      items={rowMenuItems(search)}
                      open={openMenuId === search.id}
                      onOpenChange={(next) => setOpenMenuId(next ? search.id : null)}
                    />
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>

      {pages > 1 ? (
        <div className={styles.pager}>
          <span className={styles.pagerCount}>
            {`${filteredList.length}件中 ${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, filteredList.length)}件`}
          </span>
          <Pagination page={currentPage} pageCount={pages} onPageChange={setPage} ariaLabel="保存した検索のページ送り" />
        </div>
      ) : null}

      <p className={styles.footNote}>
        {canEdit ? `保存は最大 ${MAX_SAVED} 件。行の「…」に：編集・複製して保存・削除` : `保存は最大 ${MAX_SAVED} 件。`}
      </p>
    </DelayedSkeleton>
  )

  return (
    <>
      <KpiBand data-design="KPIs" className={styles.kpis}>
        {kpiCards.map((kpi) => (
          <KpiCard
            key={kpi.title}
            presentation="band"
            title={kpi.title}
            icon={<kpi.icon size={13} aria-hidden="true" />}
            value={kpi.value}
            unit={kpi.value == null ? '' : kpi.unit}
            detail={kpi.detail}
          />
        ))}
      </KpiBand>

      <div className={styles.infoRow}>
        <p className={styles.readonlyBand}>
          <Info className={styles.readonlyIcon} aria-hidden="true" />
          友だち一覧で絞り込みを作り「この条件を保存」で保存します。配信や自動処理の宛先にも使えます。
        </p>
      </div>

      <ListPageBody
        toolbar={<>
          <span className={styles.search}>
            <SearchField aria-label="条件名で探す" placeholder="条件名で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />
          </span>
          <Select
            value={usageFilter}
            onChange={(value) => setUsageFilter(value as SavedSearchUsageFilter)}
            aria-label="使っている所で絞り込む"
            options={[
              { value: 'all', label: '使っている所：すべて' },
              { value: 'used', label: '使っている所：あり' },
              { value: 'unused', label: '使っている所：なし' },
            ]}
          />
          <Select
            value={matchFilter}
            onChange={(value) => setMatchFilter(value as typeof matchFilter)}
            aria-label="該当人数で絞り込む"
            options={[
              { value: 'all', label: '該当人数：すべて' },
              { value: 'matched', label: '該当人数：1人以上' },
              { value: 'zero', label: '該当人数：0人' },
              { value: 'unknown', label: '該当人数：未集計' },
            ]}
          />
          <span className={styles.toolbarSpacer} />
          <PageSizeSelect value={pageSize} onChange={(value) => setPageSize(value || 20)} options={PAGE_SIZES} label={null} />
        </>}
      >
        {error ? (
          <p role="alert" className={styles.errorBand}>
            <AlertCircle className={styles.errorIcon} aria-hidden="true" />
            {error}
            {retryOrder ? (
              <button type="button" onClick={() => { const next = retryOrder; setRetryOrder(null); if (next) void applyOrder(next) }}>再試行</button>
            ) : (
              <button type="button" onClick={() => { setError(''); void load() }}>読み直す</button>
            )}
          </p>
        ) : null}
        {table}
      </ListPageBody>

      {/* 行の詳細パネル。名前はその場で直せる。 */}
      <DetailPanel
        open={activeSearch !== null}
        title={activeSearch?.name ?? ''}
        description={activeSearch ? `${activeSearch.isShared ? '全員' : '自分だけ'}・v${activeSearch.revision ?? 1}` : undefined}
        onClose={() => setActiveSearchId(null)}
        hasPrev={activeSearchIndex > 0}
        hasNext={activeSearchIndex >= 0 && activeSearchIndex < visible.length - 1}
        onPrev={activeSearchIndex > 0 ? () => setActiveSearchId(visible[activeSearchIndex - 1].id) : undefined}
        onNext={activeSearchIndex >= 0 && activeSearchIndex < visible.length - 1 ? () => setActiveSearchId(visible[activeSearchIndex + 1].id) : undefined}
        footer={activeSearch?.lineAccountId ? (
          <>
            <Button href={`/friends?savedSearch=${activeSearch.id}`}>友だち一覧へ</Button>
            {canEdit ? <Button href={`/tags/searches/edit?id=${encodeURIComponent(activeSearch.id)}`}>編集する</Button> : null}
          </>
        ) : undefined}
      >
        {activeSearch ? (
          <dl className={styles.detailList}>
            <div>
              <dt>検索名</dt>
              <dd>
                {/* 閲覧のみ：鉛筆は置かず、名前だけを見せる（2026-10-06 オーナー決定）。 */}
                {canEdit ? (
                  <InlineEdit
                    label="検索名"
                    value={activeSearch.name}
                    maxLength={60}
                    disabled={!activeSearch.lineAccountId}
                    onSave={async (next) => {
                      if (!activeSearch.lineAccountId) throw new Error('no account')
                      const res = await api.savedSearches.update(activeSearch.id, activeSearch.lineAccountId, { name: next })
                      if (!res.success) throw new Error(res.error)
                      void load()
                    }}
                  />
                ) : activeSearch.name}
              </dd>
            </div>
            <div><dt>条件</dt><dd>{conditionSummary(splitConditions(activeSearch.conditions, tags, conditionLabels))}</dd></div>
            <div>
              <dt>該当</dt>
              <dd>
                {activeSearch.lineAccountId && activeSearch.matchCount !== null && activeSearch.matchCount !== undefined ? (
                  <Link href={`/friends?savedSearch=${activeSearch.id}`} className={styles.countLink}>{`${formatNumber(activeSearch.matchCount)}人`}</Link>
                ) : '—'}
              </dd>
            </div>
            <div><dt>使っている所</dt><dd>{usageSummary(activeSearch.usedIn)}</dd></div>
            <div><dt>更新</dt><dd>{updatedText(activeSearch)}</dd></div>
          </dl>
        ) : null}
      </DetailPanel>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`保存した検索「${pendingDelete?.name ?? ''}」を削除しますか？`}
        description="この操作は元に戻せません。使用中の検索は削除できません。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { const target = pendingDelete; if (target) void confirmRemove(target) }}
      />
    </>
  )
}
