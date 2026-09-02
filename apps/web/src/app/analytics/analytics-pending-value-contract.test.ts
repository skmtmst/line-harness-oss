import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 帯の1枚ぶんだけを切り出す。ファイル全体を見ると別の帯に当たって素通りする。 */
function kpiCard(title: string): string {
  const at = PAGE.indexOf(`title="${title}"`)
  if (at < 0) return ''
  const start = PAGE.lastIndexOf('<KpiCard', at)
  const end = PAGE.indexOf('/>', at)
  return PAGE.slice(start, end)
}

/** 関数の中身だけを切り出す。別の関数の同じ字面に当たらないようにする。 */
function bodyOf(header: string): string {
  const at = PAGE.indexOf(header)
  if (at < 0) return ''
  const next = PAGE.indexOf('\nfunction ', at + header.length)
  return PAGE.slice(at, next < 0 ? PAGE.length : next)
}

/**
 * 検証環境（`3a21ef5e`）で、警告帯に「日別集計の初回更新を待っています」と
 * 出ているのに、帯は「増えた友だち **0人**」「減った友だち **0人**」
 * 「差し引き **0人**」だった。表も30行すべて 0。
 *
 * **同じカードの中で「まだ無い」と「0人」を同時に言っている。**
 * 決めごとでは、繋がっていない・まだ取れていない値は `—`＋理由。
 * `0` は実測が0のときだけ。
 *
 * 契約は各指標が自分で状態を持っている：
 *   `AnalyticsMetric<T> = { value: T|null; state: AnalyticsMetricState; reason: string|null }`
 * 画面がこの `state` を見ずに `value` をそのまま描いていたのが原因。
 */
describe('分析は、集計できていない値を0と書かない', () => {
  it('数を出してよい状態を1か所で決めている', () => {
    expect(PAGE).toContain('function shownValue(metric: AnalyticsMetric<number>): number | null')
    const body = bodyOf('function shownValue(metric: AnalyticsMetric<number>): number | null')
    expect(body, '実測できたときだけ数を出す、という条件になっていない')
      .toContain("metric.state === 'available' || metric.state === 'partial'")
  })

  for (const title of ['増えた友だち', '減った友だち', '差し引き', '現在つながっている']) {
    it(`「${title}」の帯は metric.value を直に描かない`, () => {
      const card = kpiCard(title)
      expect(card, '帯が見つからない').not.toBe('')
      expect(card, 'state を見ずに value をそのまま出している')
        .not.toMatch(/value=\{overview\.metrics\.\w+\.value\}/)
    })
  }

  it('差し引きは、増加と減少が出せないときに道連れで出さない', () => {
    expect(PAGE).toContain(
      'const netValue = addedValue === null || removedValue === null ? null : shownValue(overview.metrics.net)',
    )
  })

  it('日ごとの表も、集計できていないときは0の行を並べない', () => {
    expect(PAGE).toContain(
      "const daysShown = overview.state === 'available' || overview.state === 'partial'",
    )
    expect(PAGE).toContain('{!daysShown ?')
  })

  it('表の桁も state を見る', () => {
    const body = bodyOf('function MetricCell({ metric, percent, currency }: {')
    expect(body, 'MetricCell が見つからない').not.toBe('')
    expect(body, 'value === null しか見ておらず、集計待ちの0が実測の0と同じ濃さで出る')
      .toContain("const shown = metric.state === 'available' || metric.state === 'partial'")
  })
})
