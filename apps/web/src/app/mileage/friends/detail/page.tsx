'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, Td, Th, Tr } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  api,
  type FriendDetail,
  type MileageConnectedAccount,
  type MileageFriendV6,
  type MileageAdminHistoryItem,
  type MileageHistoryItem,
  type MileageSelfInsights,
  type MileageSummary,
} from '@/lib/api'
import {
  formatMileageChange,
  formatMileageDate,
  mileageEntryTypeLabel,
  mileageSourceLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
} from '../../mileage-display'
import { mileageConnectedAccounts, mileageRewardedActions } from '../../mileage-response-state'
import MileageAdjustmentDialog from './mileage-adjustment-dialog'

type MileageDetail = {
  summary: MileageSummary
  history: MileageHistoryItem[]
  insights: MileageSelfInsights
  connections: MileageConnectedAccount[]
}

function friendHistoryItem(item: MileageAdminHistoryItem): MileageHistoryItem {
  return {
    id: item.id,
    entryType: item.entryType,
    status: item.status,
    amount: item.amount,
    reason: item.reason,
    source: item.source,
    sourceEventId: item.hasSourceEvent ? item.id : null,
    sourceReferenceId: item.sourceReferenceId,
    ruleName: item.ruleName,
    mode: item.mode,
    executedByStaffName: item.executedByStaffName,
    balanceAfter: item.balanceAfter,
    occurredAt: item.occurredAt,
  }
}

function FriendMileageInner() {
  const searchParams = useSearchParams()
  const friendId = searchParams.get('id') ?? ''
  const openAdjustment = searchParams.get('adjust') === '1'
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const requestRef = useRef(0)
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [mileage, setMileage] = useState<MileageDetail | null>(null)
  const [v6Friend, setV6Friend] = useState<MileageFriendV6 | null>(null)
  const [v6History, setV6History] = useState<MileageHistoryItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [canAdjust, setCanAdjust] = useState(false)
  const [canConfigureAdjustmentPolicy, setCanConfigureAdjustmentPolicy] = useState(false)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
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
    try {
      const friendResponse = await api.friends.get(friendId)
      if (!friendResponse.success) throw new Error('load_failed')
      const [mileageResponse, staffResponse, v6Response, historyResponse] = await Promise.all([
        api.friends.mileage(friendId, { limit: 100, accountId: selectedAccountId }),
        api.staff.me().catch(() => null),
        api.mileage.friendsV6({
          accountId: selectedAccountId,
          search: friendResponse.data.displayName || undefined,
          limit: 100,
          offset: 0,
        }).catch(() => null),
        api.mileage.history({
          accountId: selectedAccountId,
          search: friendResponse.data.displayName || undefined,
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
        ? historyResponse.data.items
          .filter((item) => item.primaryFriendId === friendId)
          .map(friendHistoryItem)
        : null)
      setCanAdjust(Boolean(staffResponse?.success && (staffResponse.data.role === 'owner' || staffResponse.data.role === 'admin')))
      setCanConfigureAdjustmentPolicy(Boolean(staffResponse?.success && staffResponse.data.role === 'owner'))
    } catch {
      if (request !== requestRef.current) return
      setFriend(null)
      setMileage(null)
      setV6Friend(null)
      setV6History(null)
      setCanAdjust(false)
      setCanConfigureAdjustmentPolicy(false)
      setError(true)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [friendId, selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  useEffect(() => {
    if (openAdjustment && canAdjust && friend && mileage) setAdjustmentOpen(true)
  }, [canAdjust, friend, mileage, openAdjustment])

  if (accountLoading || loading) {
    return <div data-design-node="HIU5O"><ListState kind="loading" title="マイル明細を読み込んでいます" /></div>
  }
  if (!selectedAccountId) {
    return <div data-design-node="HIU5O"><ListState kind="empty" title="LINEアカウントを選択してください" description="共通トップバーでLINEアカウントを選ぶと、友だちのマイル明細を確認できます。" /></div>
  }
  if (error || !friend || !mileage) {
    return (
      <div data-design-node="HIU5O">
        <ListState
          kind="error"
          title="マイル明細を表示できませんでした"
          description="友だちが選択中のLINEアカウントにいるか確認して、再読み込みしてください。"
          action={<Button onClick={() => void load()}>マイル明細を再読み込み</Button>}
        />
      </div>
    )
  }

  const displayName = friend.displayName || '名前未設定'
  const available = v6Friend?.available ?? mileage.summary.available
  const rewardedActions = mileageRewardedActions(mileage.insights)
  const connectedAccounts = mileageConnectedAccounts(mileage.connections)
  const displayedHistory = v6History ?? mileage.history
  const reasonSummary = displayedHistory.reduce<Array<{ reason: string; count: number; amount: number }>>((items, item) => {
    const found = items.find((candidate) => candidate.reason === item.reason)
    if (found) { found.count += 1; found.amount += item.amount } else items.push({ reason: item.reason, count: 1, amount: item.amount })
    return items
  }, []).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  return (
    <div data-design-node="HIU5O" className="space-y-4">
      <Breadcrumb items={[{ label: 'マイル', href: '/mileage' }, { label: `${displayName}のマイル明細` }]} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryCard variant="v6" title="利用可能" value={available} unit=" マイル" detail="いま使える残高" />
        <SummaryCard variant="v6" title="確定待ち" value={v6Friend?.pending ?? mileage.summary.pending} unit=" マイル" detail="条件の確定を待っています" />
        <SummaryCard variant="v6" title="30日以内に失効" value={v6Friend?.expiringMiles30d ?? null} unit=" マイル" detail={v6Friend ? (v6Friend.expiringMiles30d == null ? '期限付きの付与記録はありません' : '30日以内に期限を迎える分') : '友だち別失効の取得口を確認できませんでした'} />
        <SummaryCard
          variant="v6"
          title="生涯付与"
          value={v6Friend?.lifetimeEarned ?? mileage.summary.lifetimeEarned}
          unit=" マイル"
          detail={rewardedActions === null ? '付与記録の回数は未取得' : `${rewardedActions.toLocaleString('ja-JP')}回の付与記録`}
        />
        <SummaryCard variant="v6" title="使用済み" value={v6Friend?.spent ?? mileage.summary.spent} unit=" マイル" detail={v6Friend ? `今月の増減 ${v6Friend.monthChange > 0 ? '+' : ''}${v6Friend.monthChange.toLocaleString('ja-JP')} マイル` : '交換などで使った合計'} />
      </div>

      <Card overflow="hidden">
        <CardHeader
          title="友だちと接続LINEアカウント"
          meta={connectedAccounts === null ? '—' : `${connectedAccounts.length}件を表示`}
          action={<div className="flex flex-wrap gap-2">{canAdjust ? <Button variant="primary" onClick={() => setAdjustmentOpen(true)}>マイルを手で増やす・減らす</Button> : null}<Button href={`/friends/detail?id=${encodeURIComponent(friend.id)}`}>友だちの詳細を見る</Button></div>}
        />
        <div className="flex flex-wrap items-center gap-4 p-4">
          {friend.pictureUrl ? <img src={friend.pictureUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent">{displayName.slice(0, 1)}</div>}
          <div className="min-w-44">
            <p className="font-bold text-ink">{displayName}</p>
            <p className="mt-1 text-xs text-ink-faint">本人確認済みの接続先だけを表示します</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {connectedAccounts === null ? (
              <span className="text-sm text-ink-faint">接続先を確認できませんでした</span>
            ) : connectedAccounts.length > 0 ? connectedAccounts.map((connection) => (
              <span key={connection.accountId} className="rounded-full border border-hairline bg-surface-pearl px-3 py-1 text-xs font-semibold text-ink-secondary">{connection.accountName}</span>
            )) : <span className="text-sm text-ink-faint">接続先はありません</span>}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="ランクの進み" meta={v6Friend?.rank ?? 'ランクなし'} />
          <div className="p-4">
            <p className="text-sm font-bold text-ink">{v6Friend?.nextRank ? `次は「${v6Friend.nextRank}」` : 'いちばん上のランクです'}</p>
            <p className="mt-1 text-xs text-ink-faint">{v6Friend?.milesToNextRank == null ? v6Friend?.rankReason ?? 'ランク情報を確認できません' : `あと ${v6Friend.milesToNextRank.toLocaleString('ja-JP')} マイル`}</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="何でたまったか" meta={`${reasonSummary.length}種類`} />
          <div className="divide-y divide-hairline">
            {reasonSummary.length === 0 ? <p className="p-4 text-sm text-ink-faint">付与理由の記録はありません</p> : reasonSummary.slice(0, 5).map((reason) => (
              <div key={reason.reason} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="truncate text-ink" title={reason.reason}>{reason.reason}</span>
                <span className="shrink-0 font-semibold tabular-nums text-ink-secondary">{reason.count}回 ／ {formatMileageChange(reason.amount)} マイル</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card overflow="hidden">
        <CardHeader title="付与・使用・失効・調整の履歴" meta={`最新${displayedHistory.length.toLocaleString('ja-JP')}件`} />
        {displayedHistory.length === 0 ? (
          <ListState kind="empty" title="マイルの履歴はありません" description="付与や使用が記録されると、ここに理由と日時が表示されます。" />
        ) : (
          <DataTable>
            <thead><tr><Th>発生日時</Th><Th>種類・状態</Th><Th align="right">増減</Th><Th align="right">変更後残高</Th><Th>理由</Th><Th>発生元</Th><Th>ルール・実行者</Th></tr></thead>
            <tbody>
              {displayedHistory.map((item) => (
                <Tr key={item.id}>
                  <Td><time dateTime={item.occurredAt}>{formatMileageDate(item.occurredAt)}</time></Td>
                  <Td><p className="font-semibold text-ink">{mileageEntryTypeLabel(item.entryType)}</p><p className="mt-1 text-xs text-ink-faint">{mileageStatusLabel(item.status)}</p></Td>
                  <Td align="right"><span className={item.amount < 0 ? 'font-bold text-danger' : 'font-bold text-accent'}>{formatMileageChange(item.amount)} マイル</span></Td>
                  <Td align="right" className="tabular-nums">{'balanceAfter' in item && typeof item.balanceAfter === 'number' ? `${item.balanceAfter.toLocaleString('ja-JP')} マイル` : '—'}</Td>
                  <Td><p className="max-w-56 truncate font-medium text-ink" title={item.reason}>{item.reason}</p></Td>
                  <Td>
                    <p>{mileageSourceLabel(item.source)}</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.sourceEventId != null })}
                    </p>
                  </Td>
                  <Td><p>{item.ruleName ?? '—'}</p><p className="mt-1 text-xs text-ink-faint">{item.mode === 'manual' ? item.executedByStaffName ?? '実行者は未取得' : '自動処理'}</p></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      <MileageAdjustmentDialog
        open={adjustmentOpen}
        accountId={selectedAccountId}
        friendId={friend.id}
        friendName={displayName}
        currentBalance={available}
        onCancel={() => setAdjustmentOpen(false)}
        onCompleted={load}
        canConfigurePolicy={canConfigureAdjustmentPolicy}
      />
    </div>
  )
}

/** Static export cannot enumerate friend ids, so the id stays in the query. */
export default function FriendMileagePage() {
  return (
    <Suspense fallback={<div data-design-node="HIU5O"><ListState kind="loading" title="マイル明細を読み込んでいます" /></div>}>
      <FriendMileageInner />
    </Suspense>
  )
}
