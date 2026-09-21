'use client'

import { useEffect, useState } from 'react'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { api, type FriendScoreDetail, type FriendScoreHistoryItem } from '@/lib/api'
import { actionScoreReasonLabel, formatMileageDate, formatMileageNumber } from './mileage-display'

/**
 * IDEA-17: 行動スコアの「計算理由」を1人分たどる明細窓。
 *
 * 点数そのものの一覧には「最後の反応」しか出せないので、いつ・何で・
 * どれだけ変わったか（前後の点数と理由・自動か担当者か）をここで見せる。
 * スコアはマイルと別物なので、単位は「点」、残高には触れない。
 */
function changeLabel(item: FriendScoreHistoryItem) {
  const value = item.scoreChange
  if (value > 0) return `+${formatMileageNumber(value)} 点`
  if (value < 0) return `−${formatMileageNumber(Math.abs(value))} 点`
  return '0 点'
}

function reasonText(item: FriendScoreHistoryItem) {
  const reason = item.reason?.trim()
  if (reason) return actionScoreReasonLabel(reason)
  return '点数が変わった理由は未取得'
}

export default function ActionScoreHistoryDialog({
  open,
  friendId,
  friendName,
  currentScore,
  onCancel,
}: {
  open: boolean
  friendId: string
  friendName: string
  currentScore: number | null
  onCancel: () => void
}) {
  const [detail, setDetail] = useState<FriendScoreDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open || !friendId) return
    let current = true
    setDetail(null)
    setError(false)
    setLoading(true)
    void api.scoring.friendScore(friendId)
      .then((response) => {
        if (!current) return
        if (!response.success) throw new Error(response.error)
        setDetail(response.data)
      })
      .catch(() => {
        if (!current) return
        setDetail(null)
        setError(true)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => { current = false }
  }, [friendId, open])

  const items = detail?.history ?? []

  return (
    <Dialog
      open={open}
      title="点数の変化の明細"
      description="いつ・何で点数が変わったかを新しい順に並べています。スコアは配信や対応の順番を決める目安で、お客様には見えず、マイル残高は増えも減りもしません。"
      cancelLabel="閉じる"
      onCancel={onCancel}
      busy={loading}
    >
      <div className="space-y-4">
        <section className="rounded-control bg-canvas-sunken p-4">
          <p className="text-xs font-semibold text-ink-faint">だれの点数ですか</p>
          <p className="mt-2 font-bold text-ink">{friendName}</p>
          <p className="mt-1 text-sm text-ink-secondary">
            いまの点数 {currentScore === null ? '—' : `${formatMileageNumber(detail?.currentScore ?? currentScore)} 点`}
          </p>
        </section>

        {loading ? (
          <ListState kind="loading" title="点数の変化を読み込んでいます" />
        ) : error ? (
          <ListState kind="error" title="点数の明細を表示できませんでした" description="画面を閉じて、もう一度開き直してください。" />
        ) : items.length === 0 ? (
          <ListState
            kind="empty"
            title="点数が変わった記録はありません"
            description="メッセージへの返信やリンクのクリックなど、決めたきっかけがあると記録されます。"
          />
        ) : (
          <ul className="divide-y divide-hairline rounded-panel border border-hairline" aria-label="点数が変わった記録">
            {items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <time dateTime={item.occurredAt} className="text-xs text-ink-faint">{formatMileageDate(item.occurredAt)}</time>
                  <span className={item.scoreChange < 0 ? 'font-bold text-danger' : 'font-bold text-accent'}>
                    {changeLabel(item)}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-ink" title={reasonText(item)}>{reasonText(item)}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {item.scoreBefore === null || item.scoreAfter === null
                    ? '前後の点数は未取得'
                    : `${formatMileageNumber(item.scoreBefore)} 点 → ${formatMileageNumber(item.scoreAfter)} 点`}
                  <span className="mx-1">／</span>
                  {item.mode === 'manual' ? `手で変更（${item.executedByStaffName ?? '担当者は未取得'}）` : '自動で加算'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
