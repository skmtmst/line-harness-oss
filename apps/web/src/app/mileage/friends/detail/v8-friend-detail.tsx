'use client'

/*
 * ★V8-B マイル「友だちのマイル詳細」（板 `R6kIG`、手で増やす・減らす
 * `M8zhjL`）。
 *
 * データの口は v7（friends/detail/page.tsx）と同じ口へ取りに行く。
 * 上に名前と操作（トークを開く・減らす・増やす）、数の帯は4マス一体、
 * 表は「日時・内容・きっかけ・使い道・種類・担当・増減・操作（…）」、
 * 下に「たまったきっかけ・交換した使い道」の2枚。
 * 確定待ちの確定・取消・通知の再送は行末の「…」から（操作を落とさない）。
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { MessageCircle, Minus, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { MoreHorizontal } from 'lucide-react'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import FilterChip from '@/components/shared/filter-chip'
import TargetMissing from '@/components/shared/target-missing'
import Dialog from '@/components/shared/dialog'
import { Field, TextArea } from '@/components/shared/form-controls'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
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
import {
  formatMileageChange,
  formatMileageNumber,
  formatMileageShortDateTime,
  friendHistoryItem,
  mileageDetailHasSourceEvent,
  mileageEntryTypeLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
  type MileageDetailHistoryItem,
} from '../../mileage-display'
import { mileageRewardedActions } from '../../mileage-response-state'
import { formatDay, formatNumber } from '@/lib/format'
import V8MileageAdjustDialog from './v8-mileage-adjust-dialog'
import styles from '../../mileage-v8.module.css'

type MileageDetail = {
  summary: MileageSummary
  history: MileageHistoryItem[]
  insights: MileageSelfInsights
  connections: MileageConnectedAccount[]
}

function kindOf(item: MileageDetailHistoryItem): 'earned' | 'spent' | 'voided' {
  if (item.entryType === 'grant' || (item.entryType === 'adjustment' && item.amount > 0)) return 'earned'
  if (item.entryType === 'spend') return 'spent'
  return 'voided'
}

function kindPill(kind: 'earned' | 'spent' | 'voided') {
  if (kind === 'earned') return { text: 'たまった', className: `${styles.pill} ${styles.pillActive}` }
  if (kind === 'spent') return { text: '使った', className: `${styles.pill} ${styles.pillStopped}` }
  return { text: '取り消し', className: `${styles.pill} ${styles.pillStopped}` }
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
  const [kindFilter, setKindFilter] = useState<'all' | 'earned' | 'spent' | 'voided'>('all')
  const [period, setPeriod] = useState('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)
  usePageTitle(friend?.displayName ? `${friend.displayName}のマイル明細` : null)

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
        api.mileage.friendsV6({
          accountId: selectedAccountId,
          friendId,
          limit: 1,
          offset: 0,
        }).catch(() => null),
        api.mileage.history({
          accountId: selectedAccountId,
          friendId,
          limit: 100,
          offset: 0,
        }).catch(() => null),
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
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
      } else {
        setError(true)
      }
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

  const displayedHistory: MileageDetailHistoryItem[] = useMemo(
    () => v6History ?? mileage?.history ?? [],
    [mileage, v6History],
  )
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
        <TargetMissing
          kind="unspecified"
          title="マイル明細を見る友だちが指定されていません"
          description="友だちの一覧から、明細を見る人を選び直してください。"
          backHref="/friends"
          backLabel="友だち一覧へ戻る"
        />
      </div>
    )
  }
  if (!selectedAccountId) {
    return <div data-design-node="R6kIG"><ListState kind="empty" title="LINEアカウントを選択してください" description="共通トップバーでLINEアカウントを選ぶと、友だちのマイル明細を確認できます。" /></div>
  }
  if (missing || (!error && (!friend || !mileage))) {
    return (
      <div data-design-node="R6kIG">
        <TargetMissing
          kind="not-found"
          title="この友だちは見つかりません"
          description="友だちが選択中のLINEアカウントにいるか確認して、一覧から選び直してください。"
          backHref="/friends"
          backLabel="友だち一覧へ戻る"
        />
      </div>
    )
  }
  if (error || !friend || !mileage) {
    return (
      <div data-design-node="R6kIG">
        <TargetMissing
          kind="error"
          title="マイル明細を表示できませんでした"
          description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
          onRetry={() => void load()}
        />
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
  const expiringLabel = expiring == null
    ? '記録を確認できませんでした'
    : expiring === 0
      ? '30日以内はなし'
      : `${formatMileageNumber(expiring)} マイル`
  const expiringSub = expiring == null || expiring === 0
    ? v6Friend?.nextExpiringAt ? `${formatDay(new Date(v6Friend.nextExpiringAt))}で消えます` : ''
    : v6Friend?.nextExpiringAt ? `${formatDay(new Date(v6Friend.nextExpiringAt))}で消えます` : ''
  const rewardedActions = mileageRewardedActions(mileage.insights)
  const reasonSummary = displayedHistory.reduce<Array<{ reason: string; count: number; amount: number }>>((items, item) => {
    const key = item.reason ?? '権限の外側にあるアカウントの記録'
    const found = items.find((candidate) => candidate.reason === key)
    if (found) { found.count += 1; found.amount += item.amount } else items.push({ reason: key, count: 1, amount: item.amount })
    return items
  }, []).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  const earnedReasons = reasonSummary.filter((item) => item.amount >= 0).slice(0, 5)
  const spentReasons = reasonSummary.filter((item) => item.amount < 0).slice(0, 5)
  const lastSpend = displayedHistory.find((item) => kindOf(item) === 'spent')
  const joinedAt = friend.createdAt ? formatDay(new Date(friend.createdAt)) : null
  const lastActive = v6Friend?.lastChangedAt ? formatDay(new Date(v6Friend.lastChangedAt)) : null

  return (
    <div data-design-node="R6kIG" className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <Link href="/mileage?tab=balances" style={{ color: 'var(--color-action)', fontSize: 13 }}>← マイルへ</Link>
          <h1 className={styles.headTitle}>{displayName}</h1>
          <p className={styles.headDescription}>
            {[joinedAt ? `友だちになった日 ${joinedAt}` : null, `会員ランク ${rankLabel}`, lastActive ? `最後に動いた日 ${lastActive}` : null]
              .filter(Boolean).join('・')}
          </p>
        </div>
        <div className={styles.headActions}>
          <Button href={`/friends/detail?id=${encodeURIComponent(friend.id)}`}>
            <MessageCircle size={14} aria-hidden="true" /> トークを開く
          </Button>
          {canAdjust ? (
            <>
              <Button onClick={() => { setAdjustMode('decrease'); setAdjustmentOpen(true) }}>
                <Minus size={14} aria-hidden="true" /> 減らす
              </Button>
              <Button variant="primary" onClick={() => { setAdjustMode('increase'); setAdjustmentOpen(true) }}>
                <Plus size={14} aria-hidden="true" /> 増やす
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles.kpis} role="group" aria-label="今の数">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>使える残高</span>
          </div>
          <p className={styles.kpiValue}>
            {formatMileageNumber(available)}
            <span className={styles.kpiUnit}> マイル</span>
          </p>
          <p className={styles.kpiSub}>
            {v6Friend ? `今月の増減 ${v6Friend.monthChange > 0 ? '+' : ''}${formatNumber(v6Friend.monthChange)}` : `生涯 ${formatNumber(mileage.summary.lifetimeEarned)}・使用 ${formatNumber(mileage.summary.spent)}`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>確定待ち</span>
          </div>
          <p className={styles.kpiValue}>
            {formatMileageNumber(pendingMiles)}
            <span className={styles.kpiUnit}> マイル</span>
          </p>
          <p className={styles.kpiSub}>{pendingItems.length > 0 ? `${pendingItems.length}件が確定待ち` : '確定待ちはありません'}</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>今月たまった</span>
          </div>
          <p className={styles.kpiValue}>
            {formatMileageNumber(earnedSum)}
            <span className={styles.kpiUnit}> マイル</span>
          </p>
          <p className={styles.kpiSub}>できごと {earnedThisMonth.length}回{rewardedActions === null ? '' : `・付与記録 ${formatNumber(rewardedActions)}回`}</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>期限が近い</span>
          </div>
          <p className={styles.kpiValue}>
            {expiring == null ? '—' : formatMileageNumber(expiring)}
            <span className={styles.kpiUnit}> マイル</span>
          </p>
          <p className={styles.kpiSub}>{expiringSub || expiringLabel}</p>
        </div>
      </div>

      {notificationRetryError ? <Notice tone="danger">{notificationRetryError}</Notice> : null}

      <div className={styles.toolbar}>
        <SearchField
          aria-label="内容で探す"
          value={searchInput}
          onChange={setSearchInput}
          onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setPage(1)
              setSearch(searchInput.trim())
            }
          }}
          placeholder="内容で探す"
        />
        {([
          { key: 'all' as const, label: 'すべて' },
          { key: 'earned' as const, label: 'たまった' },
          { key: 'spent' as const, label: '使った' },
          { key: 'voided' as const, label: '取り消し' },
        ]).map((chip) => (
          <FilterChip
            key={chip.key}
            selected={kindFilter === chip.key}
            onChange={() => { setPage(1); setKindFilter(chip.key) }}
            count={formatNumber(chip.key === 'all' ? counts.all : counts[chip.key])}
          >
            {chip.label}
          </FilterChip>
        ))}
        <span className={styles.toolbarRight}>
          <Select
            aria-label="期間"
            value={period}
            options={[
              { value: 'all', label: 'すべて' },
              { value: 'month', label: '今月' },
            ]}
            onChange={(value) => { setPage(1); setPeriod(value) }}
          />
          <PageSizeSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} options={[10, 20, 50]} />
        </span>
      </div>

      {visible.length === 0 ? (
        <div className={styles.stateWrap}>
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>
              {displayedHistory.length === 0 ? 'マイルの履歴はありません' : '条件に合う履歴はありません'}
            </p>
            <p className={styles.stateDesc}>
              {displayedHistory.length === 0
                ? '付与や使用が記録されると、ここに理由と日時が表示されます。'
                : '検索や絞り込みを外すと、すべて出ます'}
            </p>
            {displayedHistory.length > 0 ? (
              <div className={styles.stateActions}>
                <Button type="button" onClick={() => { setSearchInput(''); setSearch(''); setKindFilter('all'); setPeriod('all'); setPage(1) }}>
                  条件を外す
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">日時</th>
                <th scope="col">内容</th>
                <th scope="col">きっかけ・使い道</th>
                <th scope="col">種類</th>
                <th scope="col">担当</th>
                <th scope="col">増減</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const kind = kindOf(item)
                const pill = kindPill(kind)
                const rowMenu: ActionMenuItem[] = []
                if (canAdjust && item.status === 'pending' && !item.restricted) {
                  rowMenu.push({
                    id: 'confirm',
                    label: '確定する',
                    onSelect: () => {
                      setPendingAction({ entryId: item.id, kind: 'confirm', label: item.reason ?? '' })
                      setPendingReason('')
                      setPendingError('')
                    },
                  })
                  rowMenu.push({
                    id: 'void',
                    label: '取消す',
                    onSelect: () => {
                      setPendingAction({ entryId: item.id, kind: 'void', label: item.reason ?? '' })
                      setPendingReason('')
                      setPendingError('')
                    },
                  })
                }
                if (canAdjust && item.notificationStatus === 'failed' && !item.restricted) {
                  const retrying = notificationRetryId === item.id
                  rowMenu.push({
                    id: 'retry',
                    label: retrying ? '通知を送り直しています…' : '通知を再送',
                    disabled: retrying,
                    disabledReason: '通知を送り直しています',
                    onSelect: () => void retryNotification(item.id, item.lineAccountId ?? selectedAccountId ?? ''),
                  })
                }
                return (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <time dateTime={item.occurredAt}>{formatMileageShortDateTime(item.occurredAt)}</time>
                    </td>
                    <td>
                      {item.restricted || item.reason == null ? (
                        <p className={styles.cellSub}>権限の外側にあるアカウントの記録</p>
                      ) : (
                        <p className={styles.cellMain} title={item.reason}>{item.reason}</p>
                      )}
                    </td>
                    <td>
                      <p className={styles.cellSubDark} title={mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: mileageDetailHasSourceEvent(item) })}>
                        {item.ruleName ?? (mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: mileageDetailHasSourceEvent(item) }) || mileageEntryTypeLabel(item.entryType))}
                      </p>
                      <p className={styles.cellSub}>{mileageStatusLabel(item.status)}</p>
                    </td>
                    <td><span className={pill.className}>{pill.text}</span></td>
                    <td><span className={styles.cellSubDark}>{assignee(item)}</span></td>
                    <td>
                      <span className={styles.num}>{formatMileageChange(item.amount)}</span>
                      {'balanceAfter' in item && typeof item.balanceAfter === 'number' ? (
                        <p className={styles.cellSub}>残高 {formatNumber(item.balanceAfter)}</p>
                      ) : null}
                    </td>
                    <td>
                      {rowMenu.length > 0 ? (
                        <span className={styles.rowActions}>
                          <IconButton
                            aria-label="履歴の操作"
                            title="履歴の操作"
                            onClick={() => setMenuId((current) => (current === item.id ? null : item.id))}
                          >
                            <MoreHorizontal size={14} aria-hidden="true" />
                          </IconButton>
                          <ActionMenu
                            open={menuId === item.id}
                            ariaLabel="履歴の操作"
                            onClose={() => setMenuId(null)}
                            items={rowMenu}
                          />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className={styles.footer}>
          <span className={styles.footerCount}>
            {formatNumber(filtered.length)}件中 {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, filtered.length)}件
          </span>
          {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
        </div>
      ) : null}

      <div className={styles.columns}>
        <section className={styles.tableWrap} style={{ flex: '1 1 0' }} aria-label="この人がたまったきっかけ">
          <p className={styles.cellSubDark} style={{ padding: '12px 20px 0' }}><strong>この人がたまったきっかけ</strong></p>
          <div style={{ padding: '4px 20px 12px' }}>
            {earnedReasons.length === 0 ? (
              <p className={styles.cellSub}>付与理由の記録はありません</p>
            ) : earnedReasons.map((reason) => (
              <div key={reason.reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
                <span className={styles.cellSubDark} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={reason.reason}>
                  {reason.reason}
                </span>
                <span className={styles.num}>{reason.count}回・{formatMileageChange(reason.amount)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.tableWrap} style={{ flex: '1 1 0' }} aria-label="交換した使い道">
          <p className={styles.cellSubDark} style={{ padding: '12px 20px 0' }}><strong>交換した使い道</strong></p>
          <div style={{ padding: '4px 20px 12px' }}>
            {spentReasons.length === 0 ? (
              <p className={styles.cellSub}>交換の記録はありません</p>
            ) : spentReasons.map((reason) => (
              <div key={reason.reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
                <span className={styles.cellSubDark} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={reason.reason}>
                  {reason.reason}
                </span>
                <span className={styles.num}>{reason.count}回・{formatMileageChange(reason.amount)}</span>
              </div>
            ))}
            {lastSpend?.occurredAt ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
                <span className={styles.cellSub}>最後に交換した日</span>
                <span className={styles.num}>{formatDay(new Date(lastSpend.occurredAt))}</span>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 0' }}>
              <Link href="/mileage?tab=rewards" style={{ color: 'var(--color-action)', fontSize: 13 }}>使い道を見る</Link>
            </div>
          </div>
        </section>
      </div>

      {canAdjust ? (
        <V8MileageAdjustDialog
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
        description={pendingAction?.kind === 'void'
          ? '元の記録は消さず、逆向きの記録を追加して残高を戻します。'
          : '確定すると利用可能な残高へ移ります。'}
        tone={pendingAction?.kind === 'void' ? 'destructive' : 'default'}
        busy={pendingBusy}
        error={pendingError}
        confirmLabel={pendingAction?.kind === 'void' ? 'この理由で取消す' : 'この理由で確定する'}
        cancelLabel="キャンセル"
        onConfirm={() => void runPendingAction()}
        onCancel={() => { if (!pendingBusy) { setPendingAction(null); setPendingReason(''); setPendingError('') } }}
      >
        <div>
          <div className={styles.dlgPerson}>
            <div>
              <p className={styles.dlgPersonSub}>対象の記録</p>
              <p className={styles.dlgPersonName}>{pendingAction?.label}</p>
            </div>
          </div>
          <Field label="理由" htmlFor="mileage-pending-reason-v8" required>
            <TextArea
              id="mileage-pending-reason-v8"
              rows={3}
              value={pendingReason}
              onChange={(event) => setPendingReason(event.target.value)}
            />
          </Field>
          <Notice tone="info">理由は履歴に残り、あとから実行者と一緒に確認できます。</Notice>
        </div>
      </Dialog>
    </div>
  )
}

export default function V8FriendDetail() {
  return (
    <Suspense fallback={<div data-design-node="R6kIG"><ListState kind="loading" title="マイル明細を読み込んでいます" /></div>}>
      <FriendDetailInner />
    </Suspense>
  )
}
