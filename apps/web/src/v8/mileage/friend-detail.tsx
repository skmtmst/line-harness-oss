'use client'

/*
 * ★V8 マイル「友だちのマイル詳細」（板 `R6kIG`、手で増やす・減らす `M8zhjL`）。
 *
 * app/mileage/friends/detail/v8-friend-detail.tsx から動きを写し、詳細の型（DetailPage）で組み直した。
 * 頭に名前と操作（トークを開く・減らす・増やす）、数の帯は4マス、明細の箱（探す・札・期間・件数・
 * 表「日時・内容・きっかけ・使い道・種類・担当・増減・…」・ページ送り）、下に「たまったきっかけ・
 * 交換した使い道」の2枚。確定待ちの確定・取消・通知の再送は行末の「…」から。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, CircleDot, Clock3, MessageCircle, Minus, Plus, Undo2 } from 'lucide-react'
import { DetailPage } from '@/components/templates'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import { Field } from '@/components/shared/form-controls'
import { TextArea } from '@/components/shared/text-field'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  ApiError,
  type FriendDetail,
  type MileageConnectedAccount,
  type MileageFriendV6,
  type MileageHistoryItem,
  type MileageSelfInsights,
  type MileageSummary,
} from '@/lib/api'
import { formatDay, formatNumber } from '@/lib/format'
import {
  formatMileageChange,
  formatMileageNumber,
  formatMileageShortDateTime,
  friendHistoryItem,
  mileageDetailHasSourceEvent,
  mileageEntryTypeLabel,
  mileageRewardedActions,
  mileageSourceNoteText,
  mileageStatusLabel,
  type MileageDetailHistoryItem,
} from './display'
import { PerPageSelect } from './parts'
import MileageAdjustDialog from './adjust-dialog'
import styles from './mileage.module.css'

type MileageDetail = {
  summary: MileageSummary
  history: MileageHistoryItem[]
  insights: MileageSelfInsights
  connections: MileageConnectedAccount[]
}

type Kind = 'earned' | 'spent' | 'voided'

function kindOf(item: MileageDetailHistoryItem): Kind {
  if (item.entryType === 'grant' || (item.entryType === 'adjustment' && item.amount > 0)) return 'earned'
  if (item.entryType === 'spend') return 'spent'
  return 'voided'
}

const KIND_PILL: Record<Kind, { text: string; tone: 'active' | 'neutral' | 'warn' }> = {
  earned: { text: 'たまった', tone: 'active' },
  spent: { text: '使った', tone: 'neutral' },
  voided: { text: '取り消し', tone: 'warn' },
}

function assignee(item: MileageDetailHistoryItem): string {
  if (item.mode === 'manual') {
    return item.restricted ? '権限の外側の記録' : item.executedByStaffName ?? '実行者は未取得'
  }
  if (item.entryType === 'spend') return '本人'
  return '自動'
}

function FriendDetailInner() {
  const searchParams = useSearchParams()
  const friendId = searchParams.get('id') ?? ''
  const openAdjustment = searchParams.get('adjust') === '1'
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const requestRef = useRef(0)
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [mileage, setMileage] = useState<MileageDetail | null>(null)
  const [v6Friend, setV6Friend] = useState<MileageFriendV6 | null>(null)
  const [v6History, setV6History] = useState<MileageDetailHistoryItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [missing, setMissing] = useState(false)
  const [canAdjust, setCanAdjust] = useState(false)
  const [canConfigureAdjustmentPolicy, setCanConfigureAdjustmentPolicy] = useState(false)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [adjustMode, setAdjustMode] = useState<'increase' | 'decrease'>('increase')
  const [pendingAction, setPendingAction] = useState<{ entryId: string; kind: 'confirm' | 'void'; label: string } | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState('')
  const [notificationRetryId, setNotificationRetryId] = useState<string | null>(null)
  const [notificationRetryError, setNotificationRetryError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all')
  const [period, setPeriod] = useState('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)
  usePageTitle(friend?.displayName ? `${friend.displayName}のマイル明細` : null)
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'マイル', href: '/mileage?tab=balances' }])

  const load = useCallback(async () => {
    if (!selectedAccountId || !friendId) {
      setFriend(null)
      setMileage(null)
      setV6Friend(null)
      setV6History(null)
      setLoading(false)
      return
    }
    const request = ++requestRef.current
    setLoading(true)
    setError(false)
    setMissing(false)
    try {
      const friendResponse = await api.friends.get(friendId)
      if (!friendResponse.success) throw new Error('load_failed')
      const [mileageResponse, staffResponse, v6Response, historyResponse] = await Promise.all([
        api.friends.mileage(friendId, { limit: 100, accountId: selectedAccountId }),
        api.staff.me().catch(() => null),
        api.mileage.friendsV6({ accountId: selectedAccountId, friendId, limit: 1, offset: 0 }).catch(() => null),
        api.mileage.history({ accountId: selectedAccountId, friendId, limit: 100, offset: 0 }).catch(() => null),
      ])
      if (request !== requestRef.current) return
      if (!mileageResponse.success) throw new Error('load_failed')
      setFriend(friendResponse.data)
      setMileage(mileageResponse.data)
      setV6Friend(v6Response?.success && Array.isArray(v6Response.data?.items)
        ? v6Response.data.items.find((item) => item.friendId === friendId) ?? null
        : null)
      setV6History(historyResponse?.success && Array.isArray(historyResponse.data?.items)
        ? historyResponse.data.items.map(friendHistoryItem)
        : null)
      setCanAdjust(Boolean(staffResponse?.success && (staffResponse.data.role === 'owner' || staffResponse.data.role === 'admin')))
      setCanConfigureAdjustmentPolicy(Boolean(staffResponse?.success && staffResponse.data.role === 'owner'))
    } catch (caught) {
      if (request !== requestRef.current) return
      setFriend(null)
      setMileage(null)
      setV6Friend(null)
      setV6History(null)
      setCanAdjust(false)
      setCanConfigureAdjustmentPolicy(false)
      if (caught instanceof ApiError && caught.status === 404) setMissing(true)
      else setError(true)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [friendId, selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  useEffect(() => {
    if (openAdjustment && canAdjust && friend && mileage) {
      setAdjustMode('increase')
      setAdjustmentOpen(true)
    }
  }, [canAdjust, friend, mileage, openAdjustment])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const retryNotification = async (entryId: string, entryAccountId: string) => {
    setNotificationRetryId(entryId)
    setNotificationRetryError('')
    try {
      const response = await api.mileage.retryMileageNotification(entryId, { accountId: entryAccountId })
      if (!response.success) throw new ApiError(500, response.error || '通知を再送できませんでした。')
      await load()
    } catch (caught) {
      setNotificationRetryError(caught instanceof ApiError ? caught.message : '通知を再送できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setNotificationRetryId(null)
    }
  }

  const runPendingAction = async () => {
    if (!pendingAction || !selectedAccountId) return
    const reason = pendingReason.trim()
    if (!reason) {
      setPendingError('理由を入力してください')
      return
    }
    setPendingBusy(true)
    setPendingError('')
    try {
      const response = pendingAction.kind === 'confirm'
        ? await api.mileage.confirmMileageEntry(pendingAction.entryId, { accountId: selectedAccountId, reason })
        : await api.mileage.voidMileageEntry(pendingAction.entryId, { accountId: selectedAccountId, reason })
      if (!response.success) throw new ApiError(500, response.error || '処理できませんでした。もう一度お試しください。')
      setPendingAction(null)
      setPendingReason('')
      await load()
    } catch (caught) {
      setPendingError(caught instanceof ApiError ? caught.message : '処理できませんでした。もう一度お試しください。')
    } finally {
      setPendingBusy(false)
    }
  }

  const displayedHistory: MileageDetailHistoryItem[] = useMemo(() => v6History ?? mileage?.history ?? [], [mileage, v6History])
  const monthStart = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  }, [])
  const periodFrom = period === 'month' ? monthStart : undefined
  const filtered = useMemo(() => {
    const keyword = search.trim()
    return displayedHistory.filter((item) => {
      if (kindFilter !== 'all' && kindOf(item) !== kindFilter) return false
      if (periodFrom && item.occurredAt.slice(0, 10) < periodFrom) return false
      if (keyword && !(item.reason ?? '').includes(keyword)) return false
      return true
    })
  }, [displayedHistory, kindFilter, periodFrom, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const counts = useMemo(() => ({
    all: displayedHistory.length,
    earned: displayedHistory.filter((item) => kindOf(item) === 'earned').length,
    spent: displayedHistory.filter((item) => kindOf(item) === 'spent').length,
    voided: displayedHistory.filter((item) => kindOf(item) === 'voided').length,
  }), [displayedHistory])

  if (accountLoading || loading) {
    return <div data-design-node="R6kIG"><ListState kind="loading" title="マイル明細を読み込んでいます" /></div>
  }
  if (!friendId) {
    return (
      <div data-design-node="R6kIG">
        <TargetMissing kind="unspecified" title="マイル明細を見る友だちが指定されていません" description="友だちの一覧から、明細を見る人を選び直してください。" backHref="/friends" backLabel="友だち一覧へ戻る" />
      </div>
    )
  }
  if (!selectedAccountId) {
    return <div data-design-node="R6kIG"><ListState kind="empty" title="LINEアカウントを選択してください" description="共通トップバーでLINEアカウントを選ぶと、友だちのマイル明細を確認できます。" /></div>
  }
  if (missing || (!error && (!friend || !mileage))) {
    return (
      <div data-design-node="R6kIG">
        <TargetMissing kind="not-found" title="この友だちは見つかりません" description="友だちが選択中のLINEアカウントにいるか確認して、一覧から選び直してください。" backHref="/friends" backLabel="友だち一覧へ戻る" />
      </div>
    )
  }
  if (error || !friend || !mileage) {
    return (
      <div data-design-node="R6kIG">
        <TargetMissing kind="error" title="マイル明細を表示できませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void load()} />
      </div>
    )
  }

  const displayName = v6Friend?.displayName || friend.displayName || '名前未設定'
  const rankLabel = v6Friend?.rank === 'gold'
    ? 'ゴールド'
    : v6Friend?.rank === 'silver'
      ? 'シルバー'
      : v6Friend?.rank === 'bronze'
        ? 'ブロンズ'
        : v6Friend?.rank ?? 'ランクなし'
  const available = v6Friend?.available ?? mileage.summary.available
  const pendingMiles = v6Friend?.pending ?? mileage.summary.pending
  const pendingItems = displayedHistory.filter((item) => item.status === 'pending')
  const thisMonth = displayedHistory.filter((item) => item.occurredAt.slice(0, 10) >= monthStart)
  const earnedThisMonth = thisMonth.filter((item) => kindOf(item) === 'earned')
  const earnedSum = earnedThisMonth.reduce((sum, item) => sum + Math.max(0, item.amount), 0)
  const expiring = v6Friend?.expiringMiles30d
  const expiringSub = v6Friend?.nextExpiringAt
    ? `${formatDay(new Date(v6Friend.nextExpiringAt))} で消えます`
    : expiring == null ? '記録を確認できませんでした' : '30日以内はなし'
  const rewardedActions = mileageRewardedActions(mileage.insights)
  const reasonSummary = displayedHistory.reduce<Array<{ reason: string; count: number; amount: number }>>((items, item) => {
    const key = item.reason ?? '権限の外側にあるアカウントの記録'
    const found = items.find((candidate) => candidate.reason === key)
    if (found) { found.count += 1; found.amount += item.amount } else items.push({ reason: key, count: 1, amount: item.amount })
    return items
  /* 回数の多い順（絵 R6kIG は 32回・4回・1回）。同じ回数なら新しく起きた順のまま。 */
  }, []).sort((a, b) => b.count - a.count)
  const earnedReasons = reasonSummary.filter((item) => item.amount >= 0).slice(0, 5)
  const spentReasons = reasonSummary.filter((item) => item.amount < 0).slice(0, 5)
  const lastSpend = displayedHistory.find((item) => kindOf(item) === 'spent')
  const joinedAt = friend.createdAt ? formatDay(new Date(friend.createdAt)) : null
  const lastActive = v6Friend?.lastChangedAt ? formatDay(new Date(v6Friend.lastChangedAt)) : null

  const rowMenuOf = (item: MileageDetailHistoryItem): ActionMenuItem[] => {
    const items: ActionMenuItem[] = []
    if (canAdjust && item.status === 'pending' && !item.restricted) {
      items.push({
        id: 'confirm',
        label: '確定する',
        onSelect: () => { setPendingAction({ entryId: item.id, kind: 'confirm', label: item.reason ?? '' }); setPendingReason(''); setPendingError('') },
      })
      items.push({
        id: 'void',
        label: '取消す',
        onSelect: () => { setPendingAction({ entryId: item.id, kind: 'void', label: item.reason ?? '' }); setPendingReason(''); setPendingError('') },
      })
    }
    if (canAdjust && item.notificationStatus === 'failed' && !item.restricted) {
      const retrying = notificationRetryId === item.id
      items.push({
        id: 'retry',
        label: retrying ? '通知を送り直しています…' : '通知を再送',
        disabled: retrying,
        disabledReason: '通知を送り直しています',
        onSelect: () => void retryNotification(item.id, item.lineAccountId ?? selectedAccountId ?? ''),
      })
    }
    return items
  }

  const chips: Array<{ key: 'all' | Kind; label: string; icon?: React.ReactNode }> = [
    { key: 'all', label: 'すべて' },
    { key: 'earned', label: 'たまった', icon: <CircleDot size={13} aria-hidden="true" /> },
    { key: 'spent', label: '使った', icon: <Clock3 size={13} aria-hidden="true" /> },
    { key: 'voided', label: '取り消し', icon: <Undo2 size={13} aria-hidden="true" /> },
  ]

  return (
    <DetailPage
      boardId="R6kIG"
      title={displayName}
      identity={<Link href="/mileage?tab=balances" className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />マイルへ</Link>}
      description={[joinedAt ? `友だちになった日 ${joinedAt}` : null, `会員ランク ${rankLabel}`, lastActive ? `最後に動いた日 ${lastActive}` : null].filter(Boolean).join('・')}
      actions={<div className={`${styles.headActions} ${styles.headActionsPulled}`}>
        <Button href={`/friends/detail?id=${encodeURIComponent(friend.id)}`}>
          <MessageCircle size={15} aria-hidden="true" /> トークを開く
        </Button>
        {/* 増やす・減らすはオーナー・管理者だけ（ほかの人には出さない）。 */}
        {canAdjust ? (
          <>
            <Button onClick={() => { setAdjustMode('decrease'); setAdjustmentOpen(true) }}>
              <Minus size={15} aria-hidden="true" /> 減らす
            </Button>
            <Button variant="primary" onClick={() => { setAdjustMode('increase'); setAdjustmentOpen(true) }}>
              <Plus size={15} aria-hidden="true" /> 増やす
            </Button>
          </>
        ) : null}
      </div>}
    >
      <div className={styles.kpiBox}>
        <KpiBand>
          <KpiCard presentation="band" density="compact" icon={null} title="使える残高" value={available} unit="マイル"
            detail={v6Friend ? `今月の増減 ${v6Friend.monthChange > 0 ? '+' : ''}${formatNumber(v6Friend.monthChange)}` : `生涯 ${formatNumber(mileage.summary.lifetimeEarned)}・使用 ${formatNumber(mileage.summary.spent)}`} />
          <KpiCard presentation="band" density="compact" icon={null} title="確定待ち" value={pendingMiles} unit="マイル"
            detail={pendingItems.length > 0 ? `${pendingItems.length}件が確定待ち` : '確定待ちはありません'} />
          <KpiCard presentation="band" density="compact" icon={null} title="今月たまった" value={earnedSum} unit="マイル"
            detail={`できごと ${earnedThisMonth.length} 回${rewardedActions === null ? '' : `・付与記録 ${formatNumber(rewardedActions)}回`}`} />
          <KpiCard presentation="band" density="compact" icon={null} title="期限が近い" value={expiring ?? null} unit="マイル" detail={expiringSub} />
        </KpiBand>
      </div>

      {notificationRetryError ? <Notice tone="danger">{notificationRetryError}</Notice> : null}

      <section className={styles.historyBox} aria-label="マイルの明細">
        <div className={styles.historyTools}>
          <div className={styles.historySearch}>
            <SearchField
              aria-label="内容で探す"
              placeholder="内容で探す"
              value={searchInput}
              onChange={setSearchInput}
              onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
            />
          </div>
          <div role="group" aria-label="種類で絞り込む" className={styles.chipGroup}>
            {chips.map((chip) => (
              <FilterChip
                key={chip.key}
                selected={kindFilter === chip.key}
                icon={chip.icon}
                onChange={() => { setPage(1); setKindFilter(chip.key) }}
              >
                {`${chip.label} ${formatNumber(chip.key === 'all' ? counts.all : counts[chip.key])}`}
              </FilterChip>
            ))}
          </div>
          <span className={styles.spacer} aria-hidden="true" />
          <div className={styles.periodBox}>
            <Select
              aria-label="期間"
              value={period}
              options={[{ value: 'all', label: 'すべて' }, { value: 'month', label: '今月' }]}
              onChange={(value) => { setPage(1); setPeriod(value) }}
            />
          </div>
          <PerPageSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} />
        </div>

        {visible.length === 0 ? (
          <div className={styles.historyEmpty}>
            <p className={styles.stateTitle}>{displayedHistory.length === 0 ? 'マイルの履歴はありません' : '条件に合う履歴はありません'}</p>
            <p className={styles.stateDesc}>
              {displayedHistory.length === 0 ? '付与や使用が記録されると、ここに理由と日時が表示されます。' : '検索や絞り込みを外すと、すべて出ます'}
            </p>
            {displayedHistory.length > 0 ? (
              <Button type="button" onClick={() => { setSearchInput(''); setSearch(''); setKindFilter('all'); setPeriod('all'); setPage(1) }}>
                条件を外す
              </Button>
            ) : null}
          </div>
        ) : (
          <DataTable className={`${styles.table} ${styles.tableDetail}`}>
            <thead>
              <TableHeadRow className={styles.headRow} data-table-layout="columns">
                <Th className={styles.colWhen}>日時</Th>
                <Th className={styles.colWhat}>内容</Th>
                <Th className={styles.colSource}>きっかけ・使い道</Th>
                <Th className={styles.colKind}>種類</Th>
                <Th className={styles.colName}>担当</Th>
                <Th className={`${styles.colDeltaDetail} ${styles.alignLeft}`}>増減</Th>
                <Th className={styles.colMenu} aria-label="操作" />
              </TableHeadRow>
            </thead>
            <tbody>
              {visible.map((item) => {
                const pill = KIND_PILL[kindOf(item)]
                const menu = rowMenuOf(item)
                const note = mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: mileageDetailHasSourceEvent(item) })
                return (
                  <Tr key={item.id} className={styles.row} data-table-layout="columns">
                    <Td className={styles.colWhen}>
                      <time className={styles.cellSub} dateTime={item.occurredAt}>{formatMileageShortDateTime(item.occurredAt)}</time>
                    </Td>
                    <Td className={styles.colWhat}>
                      {item.restricted || item.reason == null ? (
                        <span className={styles.cellSub}>権限の外側にあるアカウントの記録</span>
                      ) : (
                        <span className={styles.rowLink} title={item.reason}>{item.reason}</span>
                      )}
                    </Td>
                    <Td className={styles.colSource}>
                      <span className={styles.cellMain} title={`${note}・${mileageStatusLabel(item.status)}`}>
                        {item.ruleName ?? (note || mileageEntryTypeLabel(item.entryType))}
                      </span>
                    </Td>
                    <Td className={styles.colKind}>
                      <span className={styles.pill} data-tone={pill.tone}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {pill.text}
                      </span>
                    </Td>
                    <Td className={styles.colName}><span className={styles.cellMain}>{assignee(item)}</span></Td>
                    <Td className={styles.colDeltaDetail}>
                      <span className={styles.cellMain} title={'balanceAfter' in item && typeof item.balanceAfter === 'number' ? `残高 ${formatNumber(item.balanceAfter)}` : undefined}>
                        {formatMileageChange(item.amount)}
                      </span>
                    </Td>
                    <Td className={styles.colMenu}>
                      {menu.length > 0 ? (
                        <div className={styles.menuBox}>
                          <RowMenu
                            label="明細の操作"
                            items={menu}
                            open={menuId === item.id}
                            onOpenChange={(next) => setMenuId(next ? item.id : null)}
                          />
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        )}

        {filtered.length > 0 ? (
          <div className={styles.historyPager}>
            <span className={styles.pagerCount}>
              {`${formatNumber(filtered.length)}件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, filtered.length)}件`}
            </span>
            {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
          </div>
        ) : null}
      </section>

      <div className={styles.summaryRow}>
        <section className={styles.summaryBox} aria-label="この人がたまったきっかけ">
          <h2 className={styles.summaryTitle}>この人がたまったきっかけ</h2>
          {earnedReasons.length === 0 ? (
            <p className={styles.cellSub}>付与理由の記録はありません</p>
          ) : earnedReasons.map((reason) => (
            <div key={reason.reason} className={styles.summaryLine}>
              <span className={styles.summaryKey} title={reason.reason}>{reason.reason}</span>
              <span className={styles.summaryValue}>{`${reason.count}回・${formatMileageNumber(reason.amount)}`}</span>
            </div>
          ))}
        </section>
        <section className={styles.summaryBox} aria-label="交換した使い道">
          <h2 className={styles.summaryTitle}>交換した使い道</h2>
          {spentReasons.length === 0 ? (
            <p className={styles.cellSub}>交換の記録はありません</p>
          ) : spentReasons.map((reason) => (
            <div key={reason.reason} className={styles.summaryLine}>
              <span className={styles.summaryKey} title={reason.reason}>{reason.reason}</span>
              <span className={styles.summaryValue}>{`${reason.count}回・${formatMileageChange(reason.amount)}`}</span>
            </div>
          ))}
          {lastSpend?.occurredAt ? (
            <div className={styles.summaryLine}>
              <span className={styles.summaryKey}>最後に交換した日</span>
              <span className={styles.summaryValue}>{formatDay(new Date(lastSpend.occurredAt))}</span>
            </div>
          ) : null}
          <div className={styles.summaryFoot}>
            <Link href="/mileage?tab=rewards" className={styles.backLink}>使い道を見る</Link>
          </div>
        </section>
      </div>

      {canAdjust ? (
        <MileageAdjustDialog
          key={adjustMode}
          open={adjustmentOpen}
          accountId={selectedAccountId ?? ''}
          friendId={friend.id}
          friendName={displayName}
          friendRank={rankLabel === 'ランクなし' ? null : rankLabel}
          currentBalance={available}
          initialDirection={adjustMode}
          onCancel={() => setAdjustmentOpen(false)}
          onCompleted={load}
          canConfigurePolicy={canConfigureAdjustmentPolicy}
        />
      ) : null}
      <Dialog
        open={pendingAction !== null}
        title={pendingAction?.kind === 'void' ? 'この記録を取り消します' : '確定待ちを確定します'}
        description={pendingAction?.kind === 'void' ? '元の記録は消さず、逆向きの記録を追加して残高を戻します。' : '確定すると利用可能な残高へ移ります。'}
        tone={pendingAction?.kind === 'void' ? 'destructive' : 'default'}
        busy={pendingBusy}
        error={pendingError}
        confirmLabel={pendingAction?.kind === 'void' ? 'この理由で取消す' : 'この理由で確定する'}
        cancelLabel="キャンセル"
        onConfirm={() => void runPendingAction()}
        onCancel={() => { if (!pendingBusy) { setPendingAction(null); setPendingReason(''); setPendingError('') } }}
      >
        <div className={styles.dlgBody}>
          <div className={styles.dlgPerson}>
            <div className={styles.dlgPersonText}>
              <span className={styles.dlgPersonSub}>対象の記録</span>
              <span className={styles.dlgPersonName}>{pendingAction?.label}</span>
            </div>
          </div>
          <Field label="理由" htmlFor="mileage-pending-reason" required>
            <TextArea id="mileage-pending-reason" rows={3} value={pendingReason} onChange={(event) => setPendingReason(event.target.value)} />
          </Field>
          <Notice tone="info">理由は履歴に残り、あとから実行者と一緒に確認できます。</Notice>
        </div>
      </Dialog>
    </DetailPage>
  )
}

export default function FriendDetailV8() {
  return (
    <Suspense fallback={<div data-design-node="R6kIG"><ListState kind="loading" title="マイル明細を読み込んでいます" /></div>}>
      <FriendDetailInner />
    </Suspense>
  )
}
