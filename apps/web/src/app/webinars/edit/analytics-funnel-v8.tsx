'use client'

import HelpTip from '@/components/shared/help-tip'
import './analytics-v8.css'
import type { WebinarAnalytics } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { percent } from './participants-shared'

/**
 * ウェビナー分析の数の帯と棒（Pencil V8-B `z2dgw`）。
 *
 * V8 のときだけ使う。数はすべて集計の口から来た実データで、
 * 口が無い数（どこから申し込んだか）は出さない。
 * - 数の帯：申込（今月の分）・参加（申込の割合）・視聴完了（参加の割合）・
 *   フォーム送信（CTAを押した人のうち）
 * - 棒：申込→参加（入場）→視聴完了→CTAを押した→フォーム送信。
 *   段ごとの減り（-N）と、いちばん減っている段を文で出す。
 */
function thisMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function AnalyticsFunnelV8({
  summary,
  daily,
}: {
  summary: WebinarAnalytics['summary']
  daily: WebinarAnalytics['daily']
}) {
  const monthKey = thisMonthKey()
  const monthReservations = daily
    .filter((day) => day.date.slice(0, 7) === monthKey)
    .reduce((total, day) => total + day.reservations, 0)

  const tiles = [
    { label: '申込', value: summary.reservations, unit: '人', note: `今月 +${formatNumber(monthReservations)}` },
    { label: '参加', value: summary.viewers, unit: '人', note: `申込の${percent(summary.viewers, summary.reservations)}` },
    { label: '視聴完了', value: summary.completed, unit: '人', note: `参加の${percent(summary.completed, summary.viewers)}` },
    { label: 'フォーム送信', value: summary.formSubmissions, unit: '件', note: `CTAを押した${formatNumber(summary.ctaClicks)}人のうち` },
  ]

  const stages = [
    { label: '申込', value: summary.reservations, unit: '人' },
    { label: '参加（入場）', value: summary.viewers, unit: '人' },
    { label: '視聴完了', value: summary.completed, unit: '人' },
    { label: 'CTAを押した', value: summary.ctaClicks, unit: '人' },
    { label: 'フォーム送信', value: summary.formSubmissions, unit: '件' },
  ]
  const top = Math.max(1, ...stages.map((stage) => stage.value))
  let biggestDrop = 0
  let biggestFrom = ''
  let biggestTo = ''
  stages.forEach((stage, index) => {
    if (index === 0) return
    const drop = stages[index - 1].value - stage.value
    if (drop > biggestDrop) {
      biggestDrop = drop
      biggestFrom = stages[index - 1].label
      biggestTo = stage.label
    }
  })

  return (
    <>
      <section id="webinar-analytics-tiles" aria-label="数の帯" data-analytics-kpis>
        {tiles.map((tile) => (
          <div key={tile.label} >
            <p className="text-ink-faint text-xs">{tile.label}<HelpTip label={`${tile.label}の説明`}>{tile.label === '視聴完了' ? '動画の9割以上を実際に見た人です。' : tile.label === '参加' ? '入場した人の数です。予約せず直接入場した人も含みます。' : tile.label === '申込' ? '予約した人の数です。今月の数はサーバーの集計日（UTC）を基準にしています。' : 'フォームを送信した件数です。各段の人数差は、同じ人が順番に進んだ割合を表すものではありません。'}</HelpTip></p>
            <p className="text-ink mt-2 text-2xl font-semibold tabular-nums">
              {formatNumber(tile.value)}
              <span className="ml-1 text-sm font-normal">{tile.unit}</span>
            </p>
            <p className="text-ink-faint mt-1 text-xs">{tile.note}</p>
          </div>
        ))}
      </section>

      <section id="webinar-analytics-funnel" aria-labelledby="webinar-analytics-funnel-title" className="border-hairline bg-canvas rounded-card scroll-mt-4 border p-4 shadow-card">
        <h2 id="webinar-analytics-funnel-title" className="text-ink text-base font-semibold">
          どこで人数が減っているか
        </h2>
        {biggestDrop > 0 ? (
          <p className="text-ink-secondary mt-1 text-xs">
            いちばん減っているのは「{biggestFrom} → {biggestTo}」です
          </p>
        ) : null}
        <ol className="mt-4 space-y-3">
          {stages.map((stage, index) => {
            const drop = index === 0 ? null : stages[index - 1].value - stage.value
            return (
              <li key={stage.label} className="flex items-center gap-3">
                <span className="text-ink-secondary w-24 shrink-0 text-xs">{stage.label}</span>
                <span className="bg-canvas-sunken h-5 min-w-0 flex-1 rounded-control" aria-hidden="true">
                  <span
                    className="bg-success block h-5 rounded-control"
                    style={{ width: `${Math.round((stage.value / top) * 100)}%` }}
                  />
                </span>
                <span className="text-ink w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {formatNumber(stage.value)}
                  <span className="ml-1 text-xs font-normal">{stage.unit}</span>
                </span>
                <span className="text-ink-faint w-12 shrink-0 text-right text-xs tabular-nums" aria-label={drop === null ? undefined : `${formatNumber(Math.abs(drop))}${drop >= 0 ? '減' : '増'}`}>
                  {drop === null ? '' : `${drop >= 0 ? '-' : '+'}${formatNumber(Math.abs(drop))}`}
                </span>
              </li>
            )
          })}
        </ol>
      </section>
    </>
  )
}
