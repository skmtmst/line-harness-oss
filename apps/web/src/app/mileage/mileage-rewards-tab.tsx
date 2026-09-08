'use client'

import { useCallback, useEffect, useState } from 'react'

import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import { formatMileageDate, formatMileageNumber } from './mileage-display'
import { createRequestGuard } from './redemption-request-guard'
import {
  api,
  fetchApi,
  type MileageRewardAdminOverview,
  type MileageRewardKind,
  type MileageRewardSummary,
} from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'

/** ★V6 `qlVLJ` 17-1-B マイルの使い道。 */

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 交換すると何が渡るか。**内部の記号を画面に出さない。**
 * `coupon` `early_access` のままでは、運用者にとって手がかりにならない。
 */
const KIND_LABEL: Record<MileageRewardKind, string> = {
  coupon: 'クーポンを渡す',
  tag: 'タグを付ける',
  scenario: 'シナリオを始める',
  template: 'メッセージを送る',
  early_access: '先にお知らせする',
  rank: 'ランクを上げる',
}

/**
 * 出しているか止めているか。
 *
 * **「準備中」と書かない。** 下書きは「まだ出していない」であって、
 * こちらの都合で作業中という意味ではない（`v6-common-rules` §5-5）。
 */
const STATUS_LABEL: Record<MileageRewardSummary['status'], string> = {
  draft: 'まだ出していません',
  published: '出しています',
  stopped: '止めています',
  archived: '片づけました',
}

function miles(value: number | null | undefined): string {
  const number = formatMileageNumber(value)
  return number === '—' ? number : `${number} マイル`
}

/**
 * 届かなかった交換（`GET /api/mileage/redemptions` の行）。
 * **残高の再減算はしない**ことが口の約束なので、画面は理由・回数・最終日時と
 * やり直しだけ出す。金額は出さない（減っていないものを減ったように見せる）。
 */
interface FailedRedemption {
  id: string
  rewardName: string
  status: string
  attemptCount: number
  failureCode: string | null
  failureMessage: string | null
  updatedAt: string
}

interface RedemptionHistory {
  items: FailedRedemption[]
  pagination: { total: number; limit: number; offset: number }
}

/**
 * 数に限りがあるかどうかの一行。
 *
 * **`null` は「限りなし」で、0 ではない。** 0 と書くと「品切れ」に読める。
 * 残りを数える経路が無いときも 0 にしない。
 */
function stockText(reward: MileageRewardSummary): string | null {
  const limit = reward.currentVersion?.stockLimit ?? null
  if (limit === null) return null
  /*
    括弧の中に「まだ繋がっていません。…が接続されると表示されます。」を
    そのまま入れると1行が長くなり、**限りがあること自体が読み飛ばされる。**
    ここは短く言い切り、0 と紛れないことだけ守る。
  */
  if (reward.availableCodeCount === null) return '数量に限りがあります（残りの数は取れていません）'
  return `数量に限りがあります（残り ${reward.availableCodeCount.toLocaleString('ja-JP')}個）`
}

export default function MileageRewardsTab({ accountId }: { accountId: string | null }) {
  const [overview, setOverview] = useState<MileageRewardAdminOverview | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [busyRewardId, setBusyRewardId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [failedRedemptions, setFailedRedemptions] = useState<FailedRedemption[]>([])
  const [redemptionsVisible, setRedemptionsVisible] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState('')
  /*
   * 店を A→B と切り替えたとき、遅れて届いた A の応答で B を上書きしない。
   * 世代札を取って、入れる直前に今の世代か確かめる。
   */
  const [requestGuard] = useState(createRequestGuard)

  const load = useCallback(async () => {
    const requestId = requestGuard.issue()
    if (!accountId) {
      if (!requestGuard.isCurrent(requestId)) return
      setOverview(null)
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const response = await api.mileage.rewards(accountId)
      if (!requestGuard.isCurrent(requestId)) return
      if (!response.success) throw new Error(response.error)
      /*
        **器の形を確かめてから入れる。** `rewards` が配列でない返事を
        そのまま入れると、下の `map` で一覧ごと落ちる。
      */
      if (!Array.isArray(response.data?.rewards)) throw new Error('malformed')
      setOverview(response.data)
      setStatus('ready')
    } catch (reason) {
      if (!requestGuard.isCurrent(requestId)) return
      setOverview(null)
      setStatus(reason instanceof Error && reason.message === 'forbidden' ? 'forbidden' : 'error')
    }
  }, [accountId, requestGuard])

  useEffect(() => { void load() }, [load])

  /*
   * 届かなかった交換の一覧。**使い道の一覧とは別に読む。**
   * こちらが取れなくても使い道は出す。取れないときに「0件」と書くと、
   * 届いていない交換が無いことになってしまうので、欄ごと出さない。
   */
  const loadFailedRedemptions = useCallback(async () => {
    const requestId = requestGuard.issue()
    if (!accountId) {
      if (!requestGuard.isCurrent(requestId)) return
      setFailedRedemptions([])
      setRedemptionsVisible(false)
      return
    }
    try {
      const response = await fetchApi<ApiResponse<RedemptionHistory>>(
        `/api/mileage/redemptions?accountId=${encodeURIComponent(accountId)}`,
      )
      if (!requestGuard.isCurrent(requestId)) return
      if (!response.success) throw new Error(response.error)
      if (!Array.isArray(response.data?.items)) throw new Error('malformed')
      setFailedRedemptions(
        response.data.items.filter((item) => item.status === 'delivery_failed'),
      )
      setRedemptionsVisible(true)
    } catch {
      if (!requestGuard.isCurrent(requestId)) return
      setFailedRedemptions([])
      setRedemptionsVisible(false)
    }
  }, [accountId, requestGuard])

  useEffect(() => { void loadFailedRedemptions() }, [loadFailedRedemptions])

  /*
   * 届かなかった交換のやり直し。**押した指が離れる前に止める。**
   * `retryingId` を先に立ててボタンを無効化するので、同時クリック・再送は
   * 1回にまとまる。口も失敗中だけ受け付け、同じ交換IDを続ける。
   */
  const retryRedemption = async (redemption: FailedRedemption) => {
    if (!accountId || retryingId) return
    setRetryingId(redemption.id)
    setRetryError('')
    try {
      const response = await fetchApi<ApiResponse<unknown>>(
        `/api/mileage/redemptions/${encodeURIComponent(redemption.id)}/retry-fulfillment`,
        { method: 'POST', body: JSON.stringify({ accountId }) },
      )
      if (!response.success) throw new Error(response.error)
      await loadFailedRedemptions()
      await load()
    } catch {
      setRetryError('やり直せませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setRetryingId(null)
    }
  }

  const changePublishedState = async (reward: MileageRewardSummary) => {
    if (!accountId || (reward.status !== 'published' && reward.status !== 'draft')) return
    setBusyRewardId(reward.id)
    setActionError('')
    try {
      const response = reward.status === 'published'
        ? await api.mileage.stopReward(reward.id, accountId)
        : await api.mileage.publishReward(reward.id, accountId)
      if (!response.success) throw new Error(response.error)
      await load()
    } catch {
      setActionError(reward.status === 'published'
        ? '使い道を止められませんでした。もう一度お試しください。'
        : '使い道を公開できませんでした。内容を確認してもう一度お試しください。')
    } finally {
      setBusyRewardId(null)
    }
  }

  const summary = overview?.summary
  const rewards = overview?.rewards ?? []
  const reachMetrics = Array.isArray(overview?.reachMetrics) ? overview.reachMetrics : []
  const rankBenefits = Array.isArray(overview?.rankBenefits) ? overview.rankBenefits : []

  /** 数が出せないときは、数え方の説明ではなく理由を出す。 */
  const reason = status === 'loading' ? STATE_TEXT.loading
    : status === 'forbidden' ? STATE_TEXT.forbiddenView
      : status === 'error' ? STATE_TEXT.error
        : null

  return (
    <div data-design-node="qlVLJ">
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">出している使い道</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {reason ? '—' : summary?.publishedCount ?? '—'}
            {!reason && <span className="text-ink-faint ml-0.5 text-xs font-normal">つ</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {reason ?? `まだ出していないもの ${rewards.filter((r) => r.status === 'draft').length}つ`}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月 使われたマイル</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {reason ? '—' : (summary?.redeemedMilesThisMonth ?? 0).toLocaleString('ja-JP')}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {reason ?? `${rewards.reduce((sum, r) => sum + r.exchangedThisMonth, 0).toLocaleString('ja-JP')}回`}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">1回も使っていない人</p>
          {/*
            **数える経路が無いときは `—` と理由。** 0人と書くと
            「全員が使っている」に読める。声をかける相手を取り違える。
          */}
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {reason || summary?.neverRedeemedFriendCount == null
              ? '—'
              : summary.neverRedeemedFriendCount.toLocaleString('ja-JP')}
            {!reason && summary?.neverRedeemedFriendCount != null
              && <span className="text-ink-faint ml-0.5 text-xs font-normal">人</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {reason ?? (summary?.neverRedeemedFriendCount == null
              ? notConnectedText('使っていない人の数')
              : '声かけの相手')}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">いちばん使われた</p>
          {/*
            **1回も交換されていないのに名指ししない。** 口は「いちばん多い」
            使い道を名前で返すが、その回数が0なら**まだ誰も使っていない。**
            名前を出すと「これがよく使われている」と読め、
            **伸ばす先を取り違える。**
          */}
          <p className="text-ink mt-1 truncate text-2xl font-bold">
            {reason ?? (summary?.mostRedeemedRewardCount ? summary.mostRedeemedRewardName ?? '—' : '—')}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {reason ?? (summary?.mostRedeemedRewardCount == null
              ? notConnectedText('交換の回数')
              : summary.mostRedeemedRewardCount === 0
                ? 'まだ交換されていません'
                : `${summary.mostRedeemedRewardCount.toLocaleString('ja-JP')}回`)}
          </p>
        </div>
      </div>

      {/*
        設計 `qlVLJ` の「使い道をつくる」。**つくる面（`p9CcEB` =
        `/mileage/rewards/edit`）ができたので置く。** 行き止まりにならない。
      */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-ink-secondary text-xs leading-5">
          使い道がないと、マイルはためてもらっても動きにつながりません。まず1つ、すぐ交換できる小さな使い道を出すのがおすすめです。
        </p>
        <Button variant="primary" href="/mileage/rewards/edit">使い道をつくる</Button>
      </div>

      {actionError ? <div className="mb-4 rounded-control border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{actionError}</div> : null}

      <section aria-label="ランクごとの使い道" className="mb-4 grid gap-3 md:grid-cols-3">
        {rankBenefits.length === 0 ? (
          <div className="rounded-card border border-hairline bg-canvas p-4 md:col-span-3">
            <p className="font-bold text-ink">ランクの使い道はまだありません</p>
            <p className="mt-1 text-sm text-ink-faint">ランクを上げる使い道を公開すると、必要マイルと届く人数がここに表示されます。</p>
          </div>
        ) : rankBenefits.map((rank) => (
          <div key={rank.rewardId} className="rounded-card border border-hairline bg-canvas p-4">
            <p className="truncate font-bold text-ink" title={rank.rewardName}>{rank.rewardName}</p>
            <p className="mt-1 text-sm font-semibold text-ink-secondary">{rank.requiredMiles.toLocaleString('ja-JP')} マイルから</p>
            <p className="mt-3 text-xs text-ink-secondary">今すぐ届く人 {rank.reachableFriendCount.toLocaleString('ja-JP')}人</p>
            <p className="mt-1 text-xs text-ink-faint">交換済み {rank.redeemedFriendCount.toLocaleString('ja-JP')}人</p>
          </div>
        ))}
      </section>

      <DataTable>
        <thead>
          <TableHeadRow>
            <Th>使い道</Th>
            <Th align="right">必要なマイル</Th>
            <Th>交換すると渡るもの</Th>
            <Th align="right">今月 交換された</Th>
            <Th>状態</Th>
            <Th align="right">操作</Th>
          </TableHeadRow>
        </thead>
        <tbody className="divide-hairline divide-y">
          {status === 'loading' ? <tr><td colSpan={6} className="p-0"><ListState kind="loading" /></td></tr>
            : status === 'forbidden' ? <tr><td colSpan={6} className="p-0"><ListState kind="forbidden" description="マイルの使い道を見る権限がありません。オーナーか管理者に確認してください。" /></td></tr>
              : status === 'error' ? <tr><td colSpan={6} className="p-0"><ListState kind="error" description="マイルの使い道を読み込めませんでした。" action={<Button variant="secondary" onClick={() => void load()}>使い道を再読み込み</Button>} /></td></tr>
                : rewards.length === 0 ? <tr><td colSpan={6} className="p-0"><ListState kind="empty" title="いまのところ特典なし" description="ここに1つ足すと動きが変わります。交換するとクーポンやタグが自動で渡ります。" /></td></tr>
                  : rewards.map((reward) => {
                    const stock = stockText(reward)
                    const reach = reachMetrics.find((metric) => metric.rewardId === reward.id)
                    return (
                      <Tr key={reward.id}>
                        <Td>
                          <p className="text-ink font-semibold">{reward.name}</p>
                          {reward.description && <p className="text-ink-faint text-xs">{reward.description}</p>}
                          {stock && <p className="text-ink-faint text-xs">{stock}</p>}
                          {reach && <p className="mt-1 text-xs text-ink-faint">今すぐ交換できる人 {reach.reachableFriendCount.toLocaleString('ja-JP')}人</p>}
                        </Td>
                        <Td align="right" className="tabular-nums">{miles(reward.currentVersion?.requiredMiles)}</Td>
                        <Td>{reward.benefitName ? `${KIND_LABEL[reward.rewardKind]}「${reward.benefitName}」` : KIND_LABEL[reward.rewardKind]}</Td>
                        <Td align="right" className="tabular-nums">{reward.exchangedThisMonth.toLocaleString('ja-JP')}回</Td>
                        <Td>{STATUS_LABEL[reward.status]}</Td>
                        <Td align="right">
                          <div className="flex justify-end gap-2">
                            <Button aria-label="内容を編集" href={`/mileage/rewards/edit?id=${encodeURIComponent(reward.id)}`}>中身を見る</Button>
                            {reward.status === 'published' || reward.status === 'draft' ? (
                              <Button
                                disabled={busyRewardId === reward.id}
                                onClick={() => void changePublishedState(reward)}
                              >
                                {busyRewardId === reward.id ? '反映しています' : reward.status === 'published' ? '止める' : '出す'}
                              </Button>
                            ) : null}
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
        </tbody>
      </DataTable>

      {status === 'ready' && rewards.length > 0 && (
        <p className="text-ink-faint mt-3 text-xs">
          使い道 {rewards.length}つをすべて表示
        </p>
      )}

      {/*
        届かなかった交換。**マイルは減ったまま、特典だけ届いていないもの。**
        やり直してもマイルはもう減らない（口が同じ交換IDを続ける）。
        取れなかったときは欄ごと出さない。「0件」と書くと見落とす。
      */}
      {redemptionsVisible && failedRedemptions.length > 0 && (
        <section aria-label="届かなかった交換" className="mt-6">
          <h2 className="text-ink text-sm font-bold">届かなかった交換</h2>
          <p className="text-ink-faint mt-1 text-xs leading-5">
            マイルは減ったまま、特典だけ届いていない交換です。やり直してもマイルはもう減りません。
          </p>
          {retryError ? <div className="mt-3 rounded-control border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{retryError}</div> : null}
          <div className="mt-3">
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th>使い道</Th>
                  <Th>届かなかった理由</Th>
                  <Th align="right">試した回数</Th>
                  <Th>最後の更新</Th>
                  <Th align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
                {failedRedemptions.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <p className="text-ink font-semibold">{item.rewardName}</p>
                    </Td>
                    <Td>{item.failureMessage || item.failureCode || '理由を確認できませんでした'}</Td>
                    <Td align="right" className="tabular-nums">{item.attemptCount.toLocaleString('ja-JP')}回</Td>
                    <Td>{formatMileageDate(item.updatedAt)}</Td>
                    <Td align="right">
                      <Button
                        disabled={retryingId !== null}
                        onClick={() => void retryRedemption(item)}
                      >
                        {retryingId === item.id ? 'やり直しています' : 'もう一度届ける'}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
            <p className="text-ink-faint mt-3 text-xs">
              届かなかった交換 {failedRedemptions.length}つをすべて表示
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
