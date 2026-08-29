'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Gift, Pencil, Pause, Play } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SummaryCard from '@/components/shared/summary-card'
import { api, type MileageReward, type MileageRewardOverview } from '@/lib/api'

const KIND_LABELS: Record<MileageReward['rewardKind'], string> = {
  coupon: '交換コード',
  tag: 'タグを付ける',
  scenario: 'シナリオを始める',
  template: '案内を送る',
  early_access: '先行案内',
  rank: 'ランクを変更',
}

const STATUS_LABELS: Record<MileageReward['status'], string> = {
  draft: '下書き', published: '公開中', stopped: '停止中', archived: '終了',
}

function number(value: number | null) {
  return value == null ? '—' : new Intl.NumberFormat('ja-JP').format(value)
}

export default function MileageRewardsTab({ accountId }: { accountId: string }) {
  const [data, setData] = useState<MileageRewardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await api.mileage.rewardOverview(accountId)
      if (!response.success) throw new Error(response.error)
      setData(response.data)
    } catch {
      setLoadError('マイルの使い道を読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const setStatus = async (reward: MileageReward) => {
    setSavingId(reward.id)
    setActionError('')
    try {
      const status = reward.status === 'published' ? 'stopped' : 'published'
      const response = await api.mileage.setRewardStatus(reward.id, accountId, status)
      if (!response.success) throw new Error(response.error)
      await load()
    } catch {
      setActionError('公開状態を変更できませんでした。読み直してからお試しください。')
    } finally {
      setSavingId(null)
    }
  }

  const move = async (index: number, direction: -1 | 1) => {
    if (!data) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= data.rewards.length) return
    const ids = data.rewards.map((reward) => reward.id)
    ;[ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]
    setSavingId(data.rewards[index].id)
    setActionError('')
    try {
      const response = await api.mileage.reorderRewards(accountId, ids)
      if (!response.success) throw new Error(response.error)
      await load()
    } catch {
      setActionError('並び順を保存できませんでした。読み直してからお試しください。')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return <ListState kind="loading" title="マイルの使い道を読み込んでいます" description="このまま少しお待ちください。" />
  }
  if (loadError) {
    return <ListState kind="error" title="マイルの使い道を表示できませんでした" description={loadError} action={<Button onClick={() => void load()}>再読み込み</Button>} />
  }

  const rewards = data?.rewards ?? []
  return (
    <div data-design-node="qlVLJ" data-mileage-rewards-state="ready">
      {actionError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{actionError}</div> : null}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard variant="v6" title="公開中の使い道" value={data?.summary.publishedCount ?? 0} unit="件" detail="友だちがいま交換できます" />
        <SummaryCard variant="v6" title="今月使われたマイル" value={data?.summary.redeemedMilesThisMonth ?? 0} unit=" mile" detail="交換が完了した分だけを集計" />
        <SummaryCard variant="v6" title="一度も使っていない人" value={data?.summary.neverRedeemedFriendCount ?? null} unit="人" detail="取得元を接続後に表示" badge={data?.summary.neverRedeemedFriendCount == null ? '未取得' : undefined} badgeTone="neutral" />
        <SummaryCard variant="v6" title="いちばん使われた" value={data?.summary.mostRedeemedRewardCount ?? null} unit="件" detail={data?.summary.mostRedeemedRewardName ?? 'まだ交換はありません'} />
      </div>

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Gift className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">使い道を1つ以上公開してください</p>
          <p className="mt-1 text-xs text-blue-800">ためる理由だけでなく、何に交換できるかを友だちへ伝えると、次の行動につながります。</p>
        </div>
      </div>

      {rewards.length === 0 ? (
        <ListState
          kind="empty"
          title="マイルの使い道がまだありません"
          description="交換コードやタグ、シナリオなど、マイルと引き換えに渡すものを作ります。"
          action={<Button href="/mileage/rewards/new" variant="primary">使い道をつくる</Button>}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="grid grid-cols-[minmax(220px,1.7fr)_90px_minmax(170px,1.1fr)_100px_90px_210px] items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-medium text-gray-500">
            <span>使い道</span><span>必要マイル</span><span>渡すもの</span><span>今月</span><span>状態</span><span className="text-right">操作</span>
          </div>
          <div className="divide-y divide-gray-100">
            {rewards.map((reward, index) => (
              <div key={reward.id} className="grid grid-cols-[minmax(220px,1.7fr)_90px_minmax(170px,1.1fr)_100px_90px_210px] items-center gap-3 px-4 py-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900" title={reward.name}>{reward.name}</p>
                  <p className="mt-1 truncate text-xs text-gray-500" title={reward.description ?? ''}>{reward.description || '説明はありません'}</p>
                </div>
                <span className="font-semibold text-indigo-700">{number(reward.currentVersion?.requiredMiles ?? null)}</span>
                <div className="min-w-0">
                  <p className="truncate text-gray-800">{KIND_LABELS[reward.rewardKind]}</p>
                  {reward.rewardKind === 'coupon' ? <p className="mt-1 text-xs text-gray-500">在庫 {number(reward.availableCodeCount)}件</p> : null}
                </div>
                <span>{number(reward.exchangedThisMonth)}件</span>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${reward.status === 'published' ? 'bg-green-50 text-green-700' : reward.status === 'stopped' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[reward.status]}</span>
                <div className="flex items-center justify-end gap-1">
                  <Button aria-label={`${reward.name}を上へ`} disabled={index === 0 || savingId !== null} onClick={() => void move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button aria-label={`${reward.name}を下へ`} disabled={index === rewards.length - 1 || savingId !== null} onClick={() => void move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button href={`/mileage/rewards/edit?id=${encodeURIComponent(reward.id)}`} aria-label={`${reward.name}を編集`}><Pencil className="h-4 w-4" /></Button>
                  {reward.currentPublishedVersionId ? (
                    <Button disabled={savingId !== null || reward.status === 'archived'} onClick={() => void setStatus(reward)}>
                      {reward.status === 'published' ? <><Pause className="h-4 w-4" />停止</> : <><Play className="h-4 w-4" />再開</>}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
