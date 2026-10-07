'use client'

/*
 * G-1 成果の付け方（#823）。候補になった紹介を並べ、どの決まりで
 * 付けたかを1件ずつ出す。付けなかった紹介には、その理由を残す。
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type AttributionDecisionView } from '@/lib/api'
import { TableHeadRow, Th } from '@/components/shared/table'
import Chip from '@/components/shared/chip'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'

/** 付けなかった理由を人の言葉にする。数字そのものはここに入れない。 */
export function attributionSkipReasonText(
  skipReason: AttributionDecisionView['candidates'][number]['skipReason'],
  windowDays: number,
): string {
  switch (skipReason) {
    case 'out_of_window':
      return `${windowDays}日の期間外`
    case 'self_referral':
      return '自分の紹介'
    case 'inactive_link':
      return '止めたリンク'
    case 'inactive_affiliate':
      return '止めた紹介者'
    case 'other_account':
      return '別のアカウントの紹介'
    case 'reception_closed':
      return '受付の期間外'
    case 'capped_total':
      return '全体の上限に達した'
    case 'capped_monthly':
      return '今月の上限に達した'
    default:
      return '付けなかった'
  }
}

function formatTouchedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AttributionSection({ eventId }: { eventId: string }) {
  const [view, setView] = useState<AttributionDecisionView | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await api.conversionApprovals.attribution(eventId)
      if (res.success && res.data) {
        setView(res.data)
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <ListState kind="loading" title="付け方を読み込んでいます" />
  }

  if (failed || !view) {
    return (
      <ListState
        kind="error"
        title="付け方を読み込めませんでした"
        description="通信を確かめて、もう一度お試しください。"
        onRetry={() => { void load() }}
      />
    )
  }

  if (view.candidates.length === 0) {
    return (
      <ListState
        kind="empty"
        title="候補の紹介がありません"
        description="リンクを開いた記録が期間内に無いため、誰にも付けていません。"
      />
    )
  }

  return (
    <section aria-label="成果の付け方" className="mt-3">
      <h4 className="text-ink flex items-center gap-1 text-xs font-semibold">
        成果の付け方
        <HelpTip label="数える期間の説明">
          リンクを開いてから数える期間です。案件ごとに決まり、既定は30日です。
        </HelpTip>
      </h4>
      <div className="bg-canvas border-hairline mt-2 overflow-x-auto rounded-card border">
        <table className="w-full table-fixed">
          <thead>
            <TableHeadRow>
              <Th style={{ width: '38%' }}>紹介</Th>
              <Th style={{ width: '24%' }}>いつ</Th>
              <Th style={{ width: '38%' }}>結果</Th>
            </TableHeadRow>
          </thead>
          <tbody className="divide-hairline divide-y">
            {view.candidates.map((candidate) => (
              <tr key={`${candidate.refCode}-${candidate.touchedAt}`}>
                <td className="text-ink px-4 py-2 text-sm">
                  <span className="block truncate" title={candidate.affiliateName || candidate.refCode}>
                    {candidate.affiliateName || candidate.refCode}
                  </span>
                </td>
                <td className="text-ink-secondary whitespace-nowrap px-4 py-2 text-sm tabular-nums">
                  {formatTouchedAt(candidate.touchedAt)}
                </td>
                <td className="px-4 py-2 text-sm">
                  {candidate.chosen ? (
                    <Chip tone="ok">付けた：最後に開いたリンク</Chip>
                  ) : (
                    <Chip tone="neutral">
                      付けない：{attributionSkipReasonText(candidate.skipReason, candidate.windowDays)}
                    </Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
