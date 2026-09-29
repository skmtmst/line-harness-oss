'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, TableStateRow, Td, Th, Tr } from '@/components/shared/table'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import { formatMileageDate, formatMileageNumber } from './mileage-display'
import {
  createAccountTracker,
  createMileageRewardsFetchGuards,
  createSingleFlightLock,
} from './redemption-request-guard'
import {
  ApiError,
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
 * 要対応の交換（`GET /api/mileage/redemptions` の行）。
 * **残高の再減算はしない**ことが口の約束なので、画面は状態・理由・回数・
 * 最終日時とやり直しだけ出す。金額は出さない（減っていないものを
 * 減ったように見せる）。`delivering` は送ったか分からない照合待ち。
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

/** やり直しの口の返事。返却完了でも HTTP 202＋success:false で返る。 */
interface RetryFulfillmentResponse {
  success: boolean
  data?: {
    message?: string | null
    redemption?: { status?: string }
  }
  error?: string
}

type RedemptionsLoad = 'loading' | 'ready' | 'error' | 'forbidden'

/** 1回に読む件数。口の既定（20）と同じにする。 */
const REDEMPTIONS_PAGE_SIZE = 20

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

/**
 * R365: 総件数と表示範囲を示す。最後まで読んでいないのに
 * 「すべて」と言わない。1ページに収まるときだけすべて表示と書く。
 */
function RedemptionsCount({ total, page, shown }: { total: number; page: number; shown: number }) {
  if (total <= 0 || shown <= 0) return null
  const toJa = (value: number): string => value.toLocaleString('ja-JP')
  const pageCount = Math.max(1, Math.ceil(total / REDEMPTIONS_PAGE_SIZE))
  if (pageCount === 1) {
    return (
      <p className="text-ink-faint mt-3 text-xs">
        要対応の交換 {toJa(total)}つをすべて表示
      </p>
    )
  }
  const current = Math.min(Math.max(1, page), pageCount)
  const from = (current - 1) * REDEMPTIONS_PAGE_SIZE + 1
  const to = Math.min(total, (current - 1) * REDEMPTIONS_PAGE_SIZE + shown)
  return (
    <p className="text-ink-faint mt-3 text-xs">
      要対応の交換 {toJa(total)}つ中 {toJa(from)}〜{toJa(to)}を表示
    </p>
  )
}

export default function MileageRewardsTab({ accountId }: { accountId: string | null }) {
  const [overview, setOverview] = useState<MileageRewardAdminOverview | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [busyRewardId, setBusyRewardId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [failedRedemptions, setFailedRedemptions] = useState<FailedRedemption[]>([])
  const [redemptionsVisible, setRedemptionsVisible] = useState(false)
  const [redemptionsLoad, setRedemptionsLoad] = useState<RedemptionsLoad>('loading')
  const [redemptionsPage, setRedemptionsPage] = useState(1)
  const [redemptionsTotal, setRedemptionsTotal] = useState(0)
  const [redemptionsNotice, setRedemptionsNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState('')
  /*
   * やり直しの閉じ込めが読む今のページ。stateのままだと押したときの
   * 古いページで読み直し、返却で行が消えたあとも古い offset に残る。
   */
  const redemptionsPageRef = useRef(1)
  useEffect(() => { redemptionsPageRef.current = redemptionsPage }, [redemptionsPage])
  /*
   * 店を A→B と切り替えたとき、遅れて届いた A の応答で B を上書きしない。
   * 世代札を取って、入れる直前に今の世代か確かめる。
   * **2つの取得で1つの札を使い回さない。**開いた瞬間に後が先を古くして
   * 一覧が loading のまま残るので、取得ごとに札を持つ。
   */
  const [fetchGuards] = useState(createMileageRewardsFetchGuards)
  const { overview: overviewGuard, redemptions: redemptionsGuard } = fetchGuards
  /*
   * やり直しボタン用の店の世代札。A で押した古い閉じ込めが、B へ切り替えた
   * あとに新しい世代として A を読み直し、B の画面へ混ぜないためのもの。
   */
  const [accountTracker] = useState(createAccountTracker)
  /*
   * やり直しの同時押しを1本にまとめる旗。`retryingId` だけでは止まらない。
   * 同じ束で走るクリックはどれも同じ描画の閉じ込めを見るので、状態は
   * まだ null のまま関門を通る（本物のReactで押して確認した）。
   */
  const [retryLock] = useState(createSingleFlightLock)

  /*
   * 店が替わったら世代を進め、前の店のやり直しの旗を降ろす。
   * 降ろさないと B のボタンが押せないまま残る。
   */
  useEffect(() => {
    accountTracker.track(accountId)
    retryLock.reset()
    setRetryingId(null)
    setRetryError('')
    setRedemptionsPage(1)
    setRedemptionsNotice(null)
  }, [accountId, accountTracker, retryLock])

  const load = useCallback(async () => {
    const requestId = overviewGuard.issue()
    if (!accountId) {
      if (!overviewGuard.isCurrent(requestId)) return
      setOverview(null)
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const response = await api.mileage.rewards(accountId)
      if (!overviewGuard.isCurrent(requestId)) return
      if (!response.success) throw new Error(response.error)
      /*
        **器の形を確かめてから入れる。** `rewards` が配列でない返事を
        そのまま入れると、下の `map` で一覧ごと落ちる。
      */
      if (!Array.isArray(response.data?.rewards)) throw new Error('malformed')
      setOverview(response.data)
      setStatus('ready')
    } catch (reason) {
      if (!overviewGuard.isCurrent(requestId)) return
      setOverview(null)
      setStatus(reason instanceof Error && reason.message === 'forbidden' ? 'forbidden' : 'error')
    }
  }, [accountId, overviewGuard])

  useEffect(() => { void load() }, [load])

  /*
   * 要対応の交換の一覧。**使い道の一覧とは別に読む。**
   * こちらが取れなくても使い道は出す。取れないときに欄ごと消すと、
   * 見えていない失敗を「対応不要」と誤認する（R366）。0件のときだけ
   * 欄を出さず、失敗・権限不足は理由と再読み込みを出す。
   * 21件以上あっても残りを出せるよう、ページ送りで読む（R365）。
   */
  const loadFailedRedemptions = useCallback(async (page: number) => {
    const requestId = redemptionsGuard.issue()
    if (!accountId) {
      if (!redemptionsGuard.isCurrent(requestId)) return
      setFailedRedemptions([])
      setRedemptionsVisible(false)
      setRedemptionsLoad('loading')
      setRedemptionsTotal(0)
      return
    }
    setRedemptionsLoad('loading')
    try {
      const offset = (Math.max(1, page) - 1) * REDEMPTIONS_PAGE_SIZE
      const response = await fetchApi<ApiResponse<RedemptionHistory>>(
        `/api/mileage/redemptions?accountId=${encodeURIComponent(accountId)}`
        + `&limit=${REDEMPTIONS_PAGE_SIZE}&offset=${offset}`,
      )
      if (!redemptionsGuard.isCurrent(requestId)) return
      if (!response.success) throw new Error(response.error)
      if (!Array.isArray(response.data?.items)) throw new Error('malformed')
      // 成功済み・返金済みを並べると、やり直しの押し間違いの素になる。
      // 失敗中と送ったか分からない配送中（照合待ち）だけ並べる。
      setFailedRedemptions(
        response.data.items.filter(
          (item) => item.status === 'delivery_failed' || item.status === 'delivering',
        ),
      )
      const total = response.data.pagination?.total ?? 0
      const limit = response.data.pagination?.limit || REDEMPTIONS_PAGE_SIZE
      const serverOffset = response.data.pagination?.offset ?? offset
      setRedemptionsTotal(total)
      // 返却で行が消え、今のページが空になったら1ページ目へ戻す。
      if (response.data.items.length === 0 && total > 0 && Math.max(1, page) > 1) {
        setRedemptionsPage(1)
      } else {
        setRedemptionsPage(Math.floor(serverOffset / limit) + 1)
      }
      setRedemptionsVisible(true)
      setRedemptionsLoad('ready')
    } catch (reason) {
      if (!redemptionsGuard.isCurrent(requestId)) return
      setFailedRedemptions([])
      setRedemptionsVisible(true)
      setRedemptionsTotal(0)
      const forbidden = reason instanceof ApiError
        && (reason.status === 403 || reason.code === 'forbidden')
      setRedemptionsLoad(forbidden ? 'forbidden' : 'error')
    }
  }, [accountId, redemptionsGuard])

  useEffect(() => { void loadFailedRedemptions(redemptionsPage) }, [loadFailedRedemptions, redemptionsPage])

  /*
   * 届かなかった交換のやり直し。**押した指が離れる前に止める。**
   * `retryingId` を先に立ててボタンを無効化するので、同時クリック・再送は
   * 1回にまとまる。口も失敗中だけ受け付け、同じ交換IDを続ける。
   * **押したときの店を掴んでおく。** POST の最中に B へ切り替えたら、
   * 古い閉じ込めが新しい世代として A を読み直さない。B の画面は
   * 切り替え時の取得が読むので、ここでは触らない。
   */
  const retryRedemption = async (redemption: FailedRedemption) => {
    if (!accountId || retryingId) return
    /*
     * ここが同時押しの本当の関門。押した瞬間に同期で旗を立てる。
     * 上の `retryingId` は再描画までは古いままなので、これが無いと
     * 同じ束の2回目・3回目もそのまま裏側へ飛ぶ。
     */
    if (!retryLock.acquire(redemption.id)) return
    const startedAccountId = accountId
    const operation = accountTracker.track(startedAccountId)
    setRetryingId(redemption.id)
    setRetryError('')
    setRedemptionsNotice(null)
    const reloadLists = async () => {
      await loadFailedRedemptions(redemptionsPageRef.current)
      /*
       * 1つ目の再取得を待っている間に B へ切り替わることがある。
       * ここで確かめず 2つ目を読むと、古い閉じ込めが新しい世代として
       * A を発行し、B の画面を上書きする。再取得の直前にも確かめる。
       */
      if (!accountTracker.isCurrent(operation)) return
      await load()
    }
    try {
      const response = await fetchApi<RetryFulfillmentResponse>(
        `/api/mileage/redemptions/${encodeURIComponent(redemption.id)}/retry-fulfillment`,
        { method: 'POST', body: JSON.stringify({ accountId: startedAccountId }) },
      )
      if (!accountTracker.isCurrent(operation)) return
      /*
       * R367: やり直しの返事が success:false でも、交換の状態が変わって
       * いればそのとおりに案内する。返却完了を「やり直せませんでした」
       * と出さず、古い行は一覧の読み直しで外す。
       */
      const redemptionStatus = response.data?.redemption?.status
      const serverMessage = typeof response.data?.message === 'string'
        && response.data.message.trim()
        ? response.data.message
        : null
      if (!response.success && redemptionStatus === 'refunded') {
        setRedemptionsNotice({
          tone: 'success',
          message: serverMessage ?? '交換したマイルを戻しました。',
        })
      } else if (!response.success && redemptionStatus === 'delivering') {
        setRedemptionsNotice({
          tone: 'info',
          message: serverMessage ?? '特典の送信結果を確認しています。確定するまでお待ちください。',
        })
      } else if (!response.success) {
        throw new Error(response.error)
      }
      await reloadLists()
    } catch {
      if (!accountTracker.isCurrent(operation)) return
      setRetryError('やり直せませんでした。時間をおいてもう一度お試しください。')
      // 押した間に状態が変わっていることがあるので、一覧は読み直す。
      await loadFailedRedemptions(redemptionsPageRef.current)
    } finally {
      retryLock.release(redemption.id)
      if (accountTracker.isCurrent(operation)) setRetryingId(null)
    }
  }

  /*
   * N-236: 「止めています」の使い道は、止める前と同じ公開版で
   * もう一度出せる。片づけた（archived）ものだけは、間違って戻さないよう
   * ここでは操作を出さない。
   */
  const changePublishedState = async (reward: MileageRewardSummary) => {
    if (!accountId
      || (reward.status !== 'published' && reward.status !== 'draft' && reward.status !== 'stopped')) return
    setBusyRewardId(reward.id)
    setActionError('')
    try {
      const response = reward.status === 'published'
        ? await api.mileage.stopReward(reward.id, accountId)
        : reward.status === 'stopped'
          ? await api.mileage.resumeReward(reward.id, accountId)
          : await api.mileage.publishReward(reward.id, accountId)
      if (!response.success) throw new Error(response.error)
      await load()
    } catch {
      setActionError(reward.status === 'published'
        ? '使い道を止められませんでした。もう一度お試しください。'
        : reward.status === 'stopped'
          ? '使い道をまた出せませんでした。もう一度お試しください。'
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
    <div data-design-node="qlVLJ" className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-ink-secondary text-xs leading-5">
          使い道がないと、マイルはためてもらっても動きにつながりません。まず1つ、すぐ交換できる小さな使い道を出すのがおすすめです。
        </p>
        <Button variant="primary" href="/mileage/rewards/edit">使い道をつくる</Button>
      </div>

      {actionError ? <Notice tone="danger" message={actionError} className="mb-4" /> : null}

      <section aria-label="ランクごとの使い道" className="grid gap-3 md:grid-cols-3">
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
          {status === 'loading' ? <TableStateRow colSpan={6} kind="loading" />
            : status === 'forbidden' ? <tr><td colSpan={6} className="p-0"><ListState kind="forbidden" description="マイルの使い道を見る権限がありません。オーナーか管理者に確認してください。" /></td></tr>
              : status === 'error' ? <TableStateRow colSpan={6} kind="error" description="マイルの使い道を読み込めませんでした。" onRetry={() => void load()} retryLabel="使い道を再読み込み" />
                : rewards.length === 0 ? <TableStateRow colSpan={6} kind="empty" title="いまのところ特典なし" description="ここに1つ足すと動きが変わります。交換するとクーポンやタグが自動で渡ります。" />
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
                            {reward.status === 'published' || reward.status === 'draft' || reward.status === 'stopped' ? (
                              <Button
                                disabled={busyRewardId === reward.id}
                                onClick={() => void changePublishedState(reward)}
                              >
                                {busyRewardId === reward.id
                                  ? '反映しています'
                                  : reward.status === 'published'
                                    ? '止める'
                                    : reward.status === 'stopped'
                                      ? 'また出す'
                                      : '出す'}
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
        要対応の交換。**マイルは減ったまま、特典が届いていないか、
        届いたか分からないもの。** やり直してもマイルはもう減らない
        （口が同じ交換IDを続ける）。0件のときだけ欄を出さない。
        取れないときは理由と再読み込みを出す（R366）。
      */}
      {redemptionsNotice ? (
        <Notice tone={redemptionsNotice.tone} message={redemptionsNotice.message} />
      ) : null}
      {redemptionsVisible && (failedRedemptions.length > 0 || redemptionsLoad === 'error' || redemptionsLoad === 'forbidden') && (
        <section aria-label="要対応の交換">
          <h2 className="text-ink text-sm font-bold">要対応の交換</h2>
          <p className="text-ink-faint mt-1 text-xs leading-5">
            マイルは減ったまま、特典が届いていないか、届いたか分からない交換です。やり直してもマイルはもう減りません。
          </p>
          {retryError ? <Notice tone="danger" message={retryError} className="mt-3" /> : null}
          {redemptionsLoad === 'error' || redemptionsLoad === 'forbidden' ? (
            <div className="mt-3">
              <ListState
                kind={redemptionsLoad}
                description={redemptionsLoad === 'forbidden'
                  ? '要対応の交換を見る権限がありません。オーナーか管理者に確認してください。'
                  : '要対応の交換を読み込めませんでした。'}
                onRetry={redemptionsLoad === 'error'
                  ? () => void loadFailedRedemptions(redemptionsPageRef.current)
                  : undefined}
              />
            </div>
          ) : (
            <div className="mt-3">
              <DataTable>
                <thead>
                  <TableHeadRow>
                    <Th>使い道</Th>
                    <Th className="w-24">状態</Th>
                    <Th>届かなかった理由</Th>
                    <Th align="right">試した回数</Th>
                    <Th>最後の更新</Th>
                    <Th align="right">操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody className="divide-hairline divide-y">
                  {redemptionsLoad === 'loading' && failedRedemptions.length === 0
                    ? <TableStateRow colSpan={6} kind="loading" />
                    : failedRedemptions.map((item) => (
                      <Tr key={item.id}>
                        <Td>
                          <p className="text-ink truncate font-semibold" title={item.rewardName}>{item.rewardName}</p>
                        </Td>
                        <Td>
                          {item.status === 'delivering' ? (
                            <span className="text-ink-secondary inline-flex items-center gap-1 whitespace-nowrap">
                              確認中
                              <HelpTip label="確認中の説明">
                                送った結果が分からず、確定を確認しています。二重に送らないよう自動では動かしていません。
                              </HelpTip>
                            </span>
                          ) : (
                            <span className="text-ink-secondary whitespace-nowrap">届いていない</span>
                          )}
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
              <RedemptionsCount
                total={redemptionsTotal}
                page={redemptionsPage}
                shown={failedRedemptions.length}
              />
              {Math.ceil(redemptionsTotal / REDEMPTIONS_PAGE_SIZE) > 1 ? (
                <div className="mt-3 flex justify-center">
                  <Pagination
                    page={redemptionsPage}
                    pageCount={Math.ceil(redemptionsTotal / REDEMPTIONS_PAGE_SIZE)}
                    onPageChange={(next) => setRedemptionsPage(next)}
                    ariaLabel="要対応の交換のページ送り"
                  />
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
