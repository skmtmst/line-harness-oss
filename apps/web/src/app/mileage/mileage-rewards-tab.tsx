'use client'

import { useCallback, useEffect, useState } from 'react'

import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import {
  api,
  type MileageRewardAdminOverview,
  type MileageRewardKind,
  type MileageRewardSummary,
} from '@/lib/api'

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
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ja-JP')} マイル`
    : '—'
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

  const load = useCallback(async () => {
    if (!accountId) {
      setOverview(null)
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const response = await api.mileage.rewards(accountId)
      if (!response.success) throw new Error(response.error)
      /*
        **器の形を確かめてから入れる。** `rewards` が配列でない返事を
        そのまま入れると、下の `map` で一覧ごと落ちる。
      */
      if (!Array.isArray(response.data?.rewards)) throw new Error('malformed')
      setOverview(response.data)
      setStatus('ready')
    } catch (reason) {
      setOverview(null)
      setStatus(reason instanceof Error && reason.message === 'forbidden' ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const summary = overview?.summary
  const rewards = overview?.rewards ?? []

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
        設計 `qlVLJ` はここに「使い道をつくる」を置く。**まだ置かない。**
        つくる面（`p9CcEB` = `/mileage/rewards/edit`）が development に無く、
        押した先が無いボタンは**行き止まり**になる。面ができた回で足す。
      */}
      <p className="text-ink-secondary mb-4 text-xs leading-5">
        使い道がないと、マイルはためてもらっても動きにつながりません。まず1つ、すぐ交換できる小さな使い道を出すのがおすすめです。
      </p>

      <DataTable>
        <thead>
          <TableHeadRow>
            <Th>使い道</Th>
            <Th align="right">必要なマイル</Th>
            <Th>交換すると渡るもの</Th>
            <Th align="right">今月 交換された</Th>
            <Th>状態</Th>
          </TableHeadRow>
        </thead>
        <tbody className="divide-hairline divide-y">
          {status === 'loading' ? <tr><td colSpan={5} className="p-0"><ListState kind="loading" /></td></tr>
            : status === 'forbidden' ? <tr><td colSpan={5} className="p-0"><ListState kind="forbidden" description="マイルの使い道を見る権限がありません。オーナーか管理者に確認してください。" /></td></tr>
              : status === 'error' ? <tr><td colSpan={5} className="p-0"><ListState kind="error" description="マイルの使い道を読み込めませんでした。" action={<Button variant="secondary" onClick={() => void load()}>使い道を再読み込み</Button>} /></td></tr>
                : rewards.length === 0 ? <tr><td colSpan={5} className="p-0"><ListState kind="empty" title="いまのところ特典なし" description="ここに1つ足すと動きが変わります。交換するとクーポンやタグが自動で渡ります。" /></td></tr>
                  : rewards.map((reward) => {
                    const stock = stockText(reward)
                    return (
                      <Tr key={reward.id}>
                        <Td>
                          <p className="text-ink font-semibold">{reward.name}</p>
                          {reward.description && <p className="text-ink-faint text-xs">{reward.description}</p>}
                          {stock && <p className="text-ink-faint text-xs">{stock}</p>}
                        </Td>
                        <Td align="right" className="tabular-nums">{miles(reward.currentVersion?.requiredMiles)}</Td>
                        <Td>{KIND_LABEL[reward.rewardKind]}</Td>
                        <Td align="right" className="tabular-nums">{reward.exchangedThisMonth.toLocaleString('ja-JP')}回</Td>
                        <Td>{STATUS_LABEL[reward.status]}</Td>
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
    </div>
  )
}
