'use client'

import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import { Th } from '@/components/shared/table'
import type { WebinarAnalytics } from '@/lib/api'
import { formatNumber } from '@/lib/format'

function fmtMin(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}分` : `${m}分${s}秒`
}

function fmtBucketRange(atSeconds: number, bucketSeconds: number): string {
  const from = Math.floor(atSeconds / 60)
  const to = Math.floor((atSeconds + bucketSeconds) / 60)
  return from === to ? `${from}分` : `${from}〜${to}分`
}

/**
 * J-1「どこまで見られたか」（設計 J-1）。
 * 見ていた人の割合の線を出し、申し込みボタンが出た時刻に縦の線を引く。
 * 下に3つの数字（始まり・最後まで・いちばん離れた所）を並べる。
 */
export default function RetentionSection({
  retention,
  completed,
  ctaAtSeconds,
  heartbeatRejects,
  durationSeconds,
}: {
  retention: WebinarAnalytics['retention']
  completed: number
  ctaAtSeconds: number | null
  heartbeatRejects: number
  durationSeconds: number
}) {
  const { bucketSeconds, started, points } = retention
  const empty = points.length === 0 || started === 0

  // いちばん離れた所＝前後のバケットでいちばん減った区間
  let dropAt: number | null = null
  let dropMax = 0
  for (let index = 0; index + 1 < points.length; index += 1) {
    const lost = points[index].viewers - points[index + 1].viewers
    if (lost > dropMax) {
      dropMax = lost
      dropAt = points[index + 1].atSeconds
    }
  }

  const completedRate = started > 0
    ? `${Math.round((completed / started) * 100)}%`
    : '—'

  /*
   * V8-B `z2dgw` の線の下の1行。最後・半分・申込ボタンのときの残りを
   * 始まりに見ていた人を分母に出す。数が無い所は「—」。
   */
  const rateOf = (viewers: number | null): string =>
    viewers === null || started <= 0 ? '—' : `${Math.round((viewers / started) * 100)}%`
  const viewersAtOrAfter = (atSeconds: number): number | null => {
    const hit = points.find((point) => point.atSeconds >= atSeconds)
    return hit ? hit.viewers : null
  }
  const halfViewers = durationSeconds > 0 ? viewersAtOrAfter(durationSeconds / 2) : null
  const ctaViewers = ctaAtSeconds !== null ? viewersAtOrAfter(ctaAtSeconds) : null

  const maxX = Math.max(
    bucketSeconds,
    durationSeconds,
    ctaAtSeconds ?? 0,
    ...points.map((point) => point.atSeconds + bucketSeconds),
  )
  const width = 720
  const height = 200
  const padLeft = 8
  const padRight = 8
  const padTop = 18
  const padBottom = 24
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const xOf = (at: number): number => padLeft + (at / maxX) * plotWidth
  const yOf = (viewers: number): number =>
    padTop + plotHeight - (Math.min(viewers, Math.max(started, 1)) / Math.max(started, 1)) * plotHeight
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point.atSeconds).toFixed(1)} ${yOf(point.viewers).toFixed(1)}`).join(' ')
  const ctaX = ctaAtSeconds !== null && ctaAtSeconds >= 0 && ctaAtSeconds <= maxX ? xOf(ctaAtSeconds) : null
  const tickCount = 4
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => Math.round((maxX / tickCount) * index))

  return (
    <section
      id="webinar-analytics-retention"
      aria-labelledby="webinar-analytics-retention-title"
      className="border-hairline bg-canvas scroll-mt-4 rounded-card border p-4 shadow-card"
    >
      <div className="flex items-center gap-1.5">
        <h2 id="webinar-analytics-retention-title" className="text-ink text-base font-bold">
          どこまで見られたか
        </h2>
        <HelpTip label="どこまで見られたかの説明">
          横は配信の経過時間、縦は見ていた人の割合です。申し込みボタンが出た時刻に縦の線を引いています。一時停止や隠れている時間は数えていません。
        </HelpTip>
      </div>

      {empty ? (
        <p className="text-ink-faint mt-4 text-sm">まだ視聴データがありません</p>
      ) : (
        <>
          <div className="bg-surface-pearl mt-4 rounded-control p-2">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`見ていた人の割合の線。始まりに見ていた${started}人。${ctaAtSeconds !== null ? `申し込みボタンは${fmtMin(ctaAtSeconds)}。` : ''}`}
              className="block h-50 w-full"
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={xOf(tick)}
                    y1={padTop}
                    x2={xOf(tick)}
                    y2={padTop + plotHeight}
                    className="stroke-hairline"
                    strokeWidth={1}
                  />
                  <text
                    x={xOf(tick)}
                    y={height - 6}
                    textAnchor="middle"
                    className="fill-ink-faint"
                    fontSize={11}
                  >
                    {fmtMin(tick)}
                  </text>
                </g>
              ))}
              {ctaX !== null && (
                <g>
                  <line
                    x1={ctaX}
                    y1={padTop}
                    x2={ctaX}
                    y2={padTop + plotHeight}
                    className="stroke-info"
                    strokeWidth={2}
                  />
                  <text
                    x={Math.min(ctaX + 6, width - 140)}
                    y={padTop + 2}
                    className="fill-info"
                    fontSize={12}
                    fontWeight={500}
                  >
                    申し込みボタン（{fmtMin(ctaAtSeconds ?? 0)}）
                  </text>
                </g>
              )}
              <path d={line} fill="none" className="stroke-accent-deep" strokeWidth={3} strokeLinejoin="round" />
            </svg>
            {/* 読み上げ用に、同じ数を表でも持つ。 */}
            <table className="sr-only">
              <caption>見ていた人の割合の線の数値</caption>
              <thead>
                <tr>
                  <Th scope="col">経過時間</Th>
                  <Th scope="col">見ていた人</Th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.atSeconds}>
                    <Th scope="row">{fmtMin(point.atSeconds)}</Th>
                    <td>{point.viewers}人</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-ink-secondary mt-3 text-xs">
            最後まで見た人{completedRate}（{formatNumber(completed)}人）・半分まで{rateOf(halfViewers)}・申込ボタンを出したとき{rateOf(ctaViewers)}
          </p>

          <Disclosure title="視聴の集計の詳しい内容" size="compact">
            <p className="text-ink-secondary text-xs">始まりに見ていた{formatNumber(started)}人・最後まで見た{formatNumber(completed)}人（{completedRate}）・いちばん離れた所{dropAt !== null ? fmtBucketRange(dropAt - bucketSeconds, bucketSeconds) : '—'}</p>
            <p className="text-ink-faint mt-2 text-xs">最後まで見た人は動画の9割以上を実際に見た人です。割合は始まりに見ていた人を分母にしています。</p>
          </Disclosure>

          {heartbeatRejects > 0 && (
            <p className="text-warning mt-3 text-xs">
              異常な報告を{formatNumber(heartbeatRejects)}件除いています（視聴時間に数えていません）。
            </p>
          )}
        </>
      )}
    </section>
  )
}
