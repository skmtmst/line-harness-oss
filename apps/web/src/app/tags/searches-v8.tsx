'use client'

/*
 * ★V8 友だち属性「保存した検索」タブの一覧（Pencil `IWnYX`、状態 `U0aKD`）。
 *
 * ここは管理だけ。条件を作るのは友だち一覧の絞り込みで、そこから
 * 「この条件を保存」で増える（v7 と同じ考え方）。作る口は見出しの右の
 * 「友だち一覧で条件を作る」（page 側の headAction）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Filter, ListChecks, MoreHorizontal, PhoneOutgoing, Users } from 'lucide-react'
import type { SavedSearch, Tag } from '@line-crm/shared'
import { api, ApiError, type SavedSearchSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import { TableHeadRow, Th } from '@/components/shared/table'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { mergeVisibleOrder } from '@/components/friend-fields/reorder-utils'
import { USAGE_KIND_LABELS, splitConditions } from '@/components/friend-fields/saved-search-list'
import type { SavedSearchConditionLabels } from '@/components/friends/saved-search-utils'
import {
  filterSavedSearches,
  savedSearchKpiValues,
  type SavedSearchUsageFilter,
} from '@/components/friend-fields/saved-search-kpis'
import { formatDateTime, formatNumber } from '@/lib/format'
import { notifyToast } from '@/components/shared/toast'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { TagRowsSkeleton } from './tag-rows-skeleton'
import styles from './list-v8.module.css'

export default function SearchesTabV8({ accountId, canEdit }: { accountId: string | null; canEdit: boolean }) {
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [items, setItems] = useState<SavedSearch[]>([])
  const [summary, setSummary] = useState<SavedSearchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  // 並び替え・削除の失敗（#1014 ATTR-02）。読み込みの失敗は loadError。
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
    /* 補助取得（タグ名・マーク名・シナリオ名・項目名）は一覧とは別に待つ（#1017 PERF-14）。 */
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
      const savedSearches = await api.savedSearches.list(accountId, { limit: 50 })
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

  /* 並び替えは /api/saved-searches/reorder へ1回で渡す（#1014 ATTR-02/03）。 */
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
      notifyToast(message, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void applyOrder(next) },
      })
    }
  }

  /** つまみにフォーカスして ↑/↓ で1つ動かす（N-049）。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = filteredList.map((search) => search.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((item) => item.id === i)).filter(Boolean) as SavedSearch[]
    await applyOrder(mergeVisibleOrder(items, visibleNext))
  }

  const ready = Boolean(accountId) && !loading && !loadError && !forbidden
  const kpis = summary ?? savedSearchKpiValues(items, ready)

  const filteredList = filterSavedSearches(items, query, usageFilter).filter((item) => {
    /* 未集計（null）は「0人」にも「1人以上」にも数えない（ATTR-08）。 */
    const count = item.matchCount
    const uncounted = count === null || count === undefined
    if (matchFilter === 'unknown') return uncounted
    if (uncounted) return matchFilter === 'all'
    /* 「すべて」は0人も含めた全件（R178）。 */
    if (matchFilter === 'all') return true
    return matchFilter === 'zero' ? count === 0 : count > 0
  })
  const pages = Math.max(1, Math.ceil(filteredList.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filteredList.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [query, usageFilter, matchFilter, pageSize])

  const rowMenuItems = (search: SavedSearch): ActionMenuItem[] => {
    const readonly = !canEdit
    const readonlyReason = '閲覧のみのため変更できません'
    const deleteDisabled = readonly || !search.lineAccountId || search.canDelete !== true
    const deleteReason = readonly
      ? readonlyReason
      : !search.lineAccountId
        ? '管理者が対象アカウントを割り当てるまで変更できません'
        : search.usedIn === undefined
          ? '使用先を確認できないため削除できません'
          : (search.usedIn?.length ?? 0) > 0
            ? `使用中のため削除できません（${search.usedIn?.length ?? 0}件）`
            : '削除できるか確認できません'
    const items_: ActionMenuItem[] = []
    if (search.lineAccountId) {
      items_.push({
        id: 'open',
        label: '友だち一覧へ',
        external: true,
        onSelect: () => router.push(`/friends?savedSearch=${search.id}`),
      })
      items_.push({
        id: 'edit',
        label: '編集',
        external: true,
        disabled: readonly,
        disabledReason: readonly ? readonlyReason : undefined,
        onSelect: () => router.push(`/tags/searches/edit?id=${encodeURIComponent(search.id)}`),
      })
    }
    items_.push({
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: items_.length > 0,
      disabled: deleteDisabled,
      disabledReason: deleteDisabled ? deleteReason : undefined,
      onSelect: () => setPendingDelete(search),
    })
    return items_
  }

  const kpisCards = [
    { title: '保存した条件', icon: Filter, value: kpis.total, unit: '件', detail: '上限50件' },
    { title: '配信で使用中', icon: PhoneOutgoing, value: kpis.usedInBroadcasts, unit: '件', detail: '変更時は影響確認' },
    { title: '該当者0人', icon: Users, value: kpis.zeroMatches, unit: '件', detail: '条件の見直し候補' },
    { title: '今月の呼び出し', icon: ListChecks, value: kpis.callsThisMonth, unit: '回', detail: kpis.callsThisMonth === null ? '呼び出し記録は未接続' : '配信・自動処理' },
  ]

  const filterActive = Boolean(query || usageFilter !== 'all' || matchFilter !== 'all')

  return (
    <>
      <div data-design="KPIs" className={styles.kpis}>
        {kpisCards.map((kpi) => (
          <div key={kpi.title} className={styles.kpi}>
            <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
            <p className={styles.kpiValue}>{kpi.value ?? '—'}<span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span></p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      {/* 条件は友だち一覧の絞り込みから保存する（ATTR-23）。 */}
      <p className={styles.noteBand}>
        友だち一覧の絞り込みを「この条件を保存」でここに保存します。配信や自動処理からも同じ条件を呼び出せます。
      </p>

      <div className={styles.listCol}>
        {!accountId && (
          <p className={styles.noteBand}>上部でLINE公式アカウントを選んでください。</p>
        )}
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <SearchField
              aria-label="条件名で検索"
              placeholder="条件名で検索"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
            />
          </div>
          <Select
            value={usageFilter}
            onChange={(value) => setUsageFilter(value as SavedSearchUsageFilter)}
            aria-label="使用先"
            options={[
              { value: 'all', label: '使用先：すべて' },
              { value: 'used', label: '使用中' },
              { value: 'unused', label: '未使用' },
            ]}
          />
          <Select
            value={matchFilter}
            onChange={(value) => setMatchFilter(value as typeof matchFilter)}
            aria-label="該当人数"
            options={[
              { value: 'all', label: '該当人数：すべて' },
              { value: 'matched', label: '1人以上' },
              { value: 'zero', label: '0人' },
              { value: 'unknown', label: '未集計' },
            ]}
          />
        </div>

        {error ? (
          <p role="alert" className={styles.errorBand}>
            {error}
            {retryOrder ? (
              <button type="button" onClick={() => { const next = retryOrder; setRetryOrder(null); if (next) void applyOrder(next) }}>再試行</button>
            ) : (
              <button type="button" onClick={() => void load()}>読み直す</button>
            )}
          </p>
        ) : null}

        {!accountId ? null
        : forbidden ? (
          <div className={styles.stateCard}>
            <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
              <AlertCircle size={20} aria-hidden="true" />
            </span>
            <p className={styles.stateTitle}>保存した検索を見る権限がありません</p>
            <p className={styles.stateDesc}>オーナーか管理者に確認してください。</p>
          </div>
        ) : loadError ? (
          <div className={styles.stateCard}>
            <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
              <AlertCircle size={20} aria-hidden="true" />
            </span>
            <p className={styles.stateTitle}>保存した検索を読み込めませんでした</p>
            <p className={styles.stateDesc}>{loadError}</p>
            <Button type="button" onClick={() => void load()}>もう一度試す</Button>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.stateCard}>
            <span className={styles.stateIcon}>
              <Filter size={20} aria-hidden="true" />
            </span>
            <p className={styles.stateTitle}>まだ保存した検索がありません</p>
            <p className={styles.stateDesc}>友だち一覧で条件を絞り、「この条件を保存」を押すとここに追加されます。</p>
            <Button href="/friends" variant="primary">友だち一覧で条件を作る</Button>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>条件に合う保存した検索はありません</p>
            <p className={styles.stateDesc}>条件名・使用先・該当人数を変えてください。</p>
            {filterActive ? (
              <Button type="button" onClick={() => { setQuery(''); setUsageFilter('all'); setMatchFilter('all') }}>条件を外す</Button>
            ) : null}
          </div>
        ) : (
          <DelayedSkeleton loading={loading} skeleton={<TagRowsSkeleton rows={4} narrow={[160]} />}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <TableHeadRow>
                    <Th style={{ width: 44 }}><span className="sr-only">並び替え</span></Th>
                    <Th>条件名</Th>
                    <Th>条件の要約</Th>
                    <Th>該当</Th>
                    <Th>共有</Th>
                    <Th>使用先</Th>
                    <Th>更新者・日時</Th>
                    <Th className={styles.menuCell}><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {visible.map((search) => {
                    const { all, any, note } = splitConditions(search.conditions, tags, conditionLabels)
                    const editHref = search.lineAccountId ? `/tags/searches/edit?id=${encodeURIComponent(search.id)}` : null
                    return (
                      <tr
                        key={search.id}
                        className={styles.rowClick}
                        tabIndex={0}
                        onClick={() => { if (editHref) router.push(editHref) }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget || !editHref) return
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            router.push(editHref)
                          }
                        }}
                      >
                        <td
                          onClick={(event) => event.stopPropagation()}
                          className={styles.gripCell}
                          data-fixed={!canEdit}
                        >
                          <ReorderGrip
                            label={search.name}
                            disabled={!canEdit}
                            disabledReason="閲覧のみのため並び替えできません"
                            onMove={(direction) => void keyboardMove(search.id, direction)}
                          />
                        </td>
                        <td>
                          <div className={styles.nameRow}>
                            {editHref ? (
                              <Link
                                href={editHref}
                                className={styles.cellTitle}
                                title={search.name}
                                aria-label={`${search.name} を編集`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {search.name}
                              </Link>
                            ) : (
                              <span className={styles.cellTitle} title={search.name}>{search.name}</span>
                            )}
                            {!search.lineAccountId && (
                              <span className={`${styles.miniBadge} ${styles.miniBadgeWarn}`}>対象アカウント未割り当て</span>
                            )}
                          </div>
                          <p className={styles.cellSub} title={`${search.isShared ? '全員' : '自分だけ'}・${selectedAccount?.name ?? search.lineAccountId ?? '対象未設定'}・ライブ参照・v${search.revision ?? 1}`}>
                            {search.isShared ? '全員' : '自分だけ'}・{selectedAccount?.name ?? search.lineAccountId ?? '対象未設定'}・v{search.revision ?? 1}
                          </p>
                        </td>
                        <td className={styles.cellMuted}>
                          {all.length > 0 ? <span className={styles.cellTruncate} title={all.join('・')}>{all.join('・')}・AND</span> : null}
                          {any.length > 0 ? <span className={styles.cellTruncate} title={any.join('・')}>いずれか1つ以上：{any.join('・')}・OR</span> : null}
                          {all.length === 0 && any.length === 0 ? <span>指定なし</span> : null}
                          {note ? <span className={styles.cellTruncate} title={note}>{note}</span> : null}
                        </td>
                        {/* 人数は、その条件で絞った友だち一覧へのリンク（行の「…」にも同じ口）。 */}
                        <td onClick={(event) => event.stopPropagation()} title={search.matchCountError ?? undefined}>
                          {search.lineAccountId && (search.matchCount !== null && search.matchCount !== undefined) ? (
                            <Link href={`/friends?savedSearch=${search.id}`} className={styles.countLink}>
                              {formatNumber(search.matchCount)}人
                            </Link>
                          ) : (
                            <span className={styles.cellMuted}>—</span>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.linkChip} ${search.isShared ? styles.linkChipAccent : styles.linkChipNeutral}`}>
                            {search.isShared ? '全員' : '自分だけ'}
                          </span>
                        </td>
                        <td className={styles.cellMuted}>
                          <span className={styles.cellTruncate} title={search.usedIn === undefined ? '—' : search.usedIn.length === 0 ? '未使用' : search.usedIn.map((u) => `${USAGE_KIND_LABELS[u.kind]}「${u.name}」`).join('・')}>
                            {search.usedIn === undefined ? '—' : search.usedIn.length === 0 ? '未使用' : search.usedIn.map((u) => `${USAGE_KIND_LABELS[u.kind]}「${u.name}」`).join('・')}
                          </span>
                        </td>
                        <td className={styles.cellMuted}>
                          <span className={styles.cellText}>{search.updatedBy ?? search.createdBy ?? '—'}</span>
                          <span className={styles.cellSub}>{formatDateTime(search.updatedAt ?? search.createdAt)}</span>
                        </td>
                        <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className={styles.menuButton}
                            aria-label={`保存した検索「${search.name}」の操作`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === search.id}
                            title={`保存した検索「${search.name}」の操作`}
                            onClick={() => setOpenMenuId((current) => (current === search.id ? null : search.id))}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </button>
                          <ActionMenu
                            open={openMenuId === search.id}
                            onClose={() => setOpenMenuId(null)}
                            ariaLabel={`保存した検索「${search.name}」の操作`}
                            items={rowMenuItems(search)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.pagerRow}>
              <span className={styles.pagerCount}>
                {filteredList.length}件中 {filteredList.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, filteredList.length)}件
              </span>
              <div className={styles.pagerRight}>
                <Select
                  aria-label="表示件数"
                  size="page-size"
                  value={String(pageSize)}
                  onChange={(value) => setPageSize(Number(value) || 20)}
                  options={[
                    { value: '20', label: '20件表示' },
                    { value: '50', label: '50件表示' },
                  ]}
                />
                <Pagination
                  page={currentPage}
                  pageCount={pages}
                  onPageChange={setPage}
                  ariaLabel="保存した検索のページ送り"
                />
              </div>
            </div>
          </DelayedSkeleton>
        )}
      </div>

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
