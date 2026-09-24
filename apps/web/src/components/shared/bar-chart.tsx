import React from 'react'
import { ChartNoAxesColumn } from 'lucide-react'
import { Th } from './table'
import styles from './bar-chart.module.css'

/**
 * ★V7 グラフ（ノード `h99Gb`）の日ごとの増減を描く棒グラフ。
 *
 * - 色は2つまで。増えた = `accent-deep`（正常・増えたの緑）、
 *   減った = `ink-faint` の灰色。赤は使わない。
 * - 数字は必ず文字でも読める（棒の色だけにしない）。1日の数は
 *   ボタンの読み上げ名・黒い吹き出し・読み上げ用の表の3か所に出す。
 * - 高さ0〜1pxの棒は押せないので、押せる範囲は列全体にする。
 * - 表示時の伸びる動きは付けない（毎回見るもので待たせない）。
 * - 外部ライブラリは使わない（CSS とボタンのみ）。
 */
export type BarChartItem = {
  /** 日付（`2026-09-20`）。選択状態の突き合わせに使う。 */
  key: string
  /** 横軸の文字（`9/20`）。1つおきに出す。 */
  axisLabel: string
  /** 吹き出しと読み上げの見出し（`9月20日（日）`）。 */
  tooltipTitle: string
  added: number
  removed: number
  /** 3つ目の意味（施策名など）は色を足さず文字で添える。 */
  note?: string | null
}

function defaultTitle(date: string): string {
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  return `${month}月${day}日`
}

/**
 * 分析の日ごとの集計をグラフの1列へ写す。数値はそのまま写すだけで、
 * 足し引き・丸めはしない（画面の数と一致させるため）。
 */
export function toBarChartItems(
  days: Array<{ date: string; added: number; removed: number }>,
  options?: {
    campaigns?: Array<{ date: string; name: string }>
    formatTitle?: (date: string) => string
  },
): BarChartItem[] {
  const formatTitle = options?.formatTitle ?? defaultTitle
  return days.map((day) => {
    const note = (options?.campaigns ?? [])
      .filter((item) => item.date === day.date)
      .map((item) => item.name)
      .join('、')
    return {
      key: day.date,
      axisLabel: `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`,
      tooltipTitle: formatTitle(day.date),
      added: day.added,
      removed: day.removed,
      note: note || null,
    }
  })
}

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

/** 目盛りは4本まで。上端が最大値を包むきりの良い段にする。 */
export function barChartTicks(maxValue: number): number[] {
  const max = Math.max(0, maxValue)
  const step = STEPS.find((candidate) => max / candidate <= 3) ?? STEPS[STEPS.length - 1]
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let value = 0; value <= top; value += step) ticks.push(value)
  return ticks
}

function labelStep(count: number): number {
  if (count <= 16) return 2
  return Math.ceil(count / 8)
}

/**
 * 日ごとの増減の棒グラフ。1日1列・1列全体がボタン。
 * 選んだ日は `selectedKey` の列に薄い地を敷き、押した結果の1行は
 * 画面側が出す（この部品はグラフだけを持つ）。
 */
export function BarChart({
  items,
  selectedKey,
  onSelect,
  label = '日ごとの増減',
}: {
  items: BarChartItem[]
  selectedKey?: string
  onSelect?: (key: string) => void
  label?: string
}) {
  const max = Math.max(1, ...items.flatMap((item) => [item.added, item.removed]))
  const ticks = barChartTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const step = labelStep(items.length)
  return (
    <div className={styles.chart}>
      <ul className={styles.legend} aria-label="凡例">
        <li className={styles.legendItem}>
          <span aria-hidden="true" className={[styles.swatch, styles.swatchAdded].join(' ')} />
          増えた
        </li>
        <li className={styles.legendItem}>
          <span aria-hidden="true" className={[styles.swatch, styles.swatchRemoved].join(' ')} />
          減った
        </li>
      </ul>
      <div className={styles.plot} role="group" aria-label={label}>
        {ticks.map((tick) => (
          <div
            key={tick}
            aria-hidden="true"
            className={styles.gridline}
            style={{ bottom: `${(tick / top) * 100}%` }}
          >
            <span className={styles.tick}>{tick}</span>
          </div>
        ))}
        <div className={styles.columns}>
          {items.map((item, index) => {
            const selected = selectedKey !== undefined && item.key === selectedKey
            const name =
              `${item.tooltipTitle} 増えた${item.added}人・減った${item.removed}人` +
              (item.note ? `・${item.note}` : '')
            return (
              <div key={item.key} className={styles.column}>
                <button
                  type="button"
                  className={styles.dayButton}
                  aria-pressed={selected}
                  aria-label={name}
                  title={name}
                  onClick={() => onSelect?.(item.key)}
                >
                  <span aria-hidden="true" className={styles.bars}>
                    <span
                      className={[styles.bar, styles.addedBar].join(' ')}
                      style={{ height: `${(item.added / top) * 100}%` }}
                    />
                    <span
                      className={[styles.bar, styles.removedBar].join(' ')}
                      style={{ height: `${(item.removed / top) * 100}%` }}
                    />
                  </span>
                  <span aria-hidden="true" className={styles.tooltip}>
                    <span className={styles.tooltipTitle}>{item.tooltipTitle}</span>
                    <span>
                      増えた {item.added}人・減った {item.removed}人
                    </span>
                  </span>
                </button>
                {index % step === 0 ? (
                  <span aria-hidden="true" className={styles.axisLabel}>
                    {item.axisLabel}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      {/* 読み上げ用に、同じ数を表でも持つ。見出しは共通Thを使う。 */}
      <table className={styles.srOnly}>
        <caption>{label}</caption>
        <thead>
          <tr>
            <Th scope="col">日付</Th>
            <Th scope="col">増えた</Th>
            <Th scope="col">減った</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <Th scope="row">{item.tooltipTitle}</Th>
              <td>{item.added}人</td>
              <td>{item.removed}人</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * まだ数えられないとき。0 の棒を並べず、何がそろえば出るかを書く。
 */
export function BarChartEmpty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={styles.empty} role="status">
      <ChartNoAxesColumn aria-hidden="true" className={styles.emptyIcon} />
      <p className={styles.emptyTitle}>{title}</p>
      {detail ? <p className={styles.emptyDetail}>{detail}</p> : null}
    </div>
  )
}
