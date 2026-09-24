// @vitest-environment happy-dom
/*
 * ★V7 グラフ（ノード `h99Gb`）。
 * 増えた = `accent-deep`、減った = `ink-faint` の2色まで。
 * 数字は棒の色だけでなく文字でも読める。
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BarChart, BarChartEmpty, barChartTicks, toBarChartItems } from './bar-chart'

const DIR = dirname(fileURLToPath(import.meta.url))
const tsx = readFileSync(join(DIR, 'bar-chart.tsx'), 'utf8')
const css = readFileSync(join(DIR, 'bar-chart.module.css'), 'utf8')
const analyticsPage = readFileSync(join(DIR, '..', '..', 'app', 'analytics', 'page.tsx'), 'utf8')

afterEach(() => cleanup())

const SAMPLE = toBarChartItems(
  [
    { date: '2026-09-19', added: 3, removed: 1 },
    { date: '2026-09-20', added: 6, removed: 0 },
    { date: '2026-09-21', added: 0, removed: 2 },
  ],
  {
    campaigns: [{ date: '2026-09-20', name: '朝の配信' }],
    formatTitle: (date) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`,
  },
)

describe('数の写し（画面と一致させる）', () => {
  it('日ごとの増減をそのまま写す（足し引き・丸めなし）', () => {
    expect(SAMPLE).toEqual([
      {
        key: '2026-09-19',
        axisLabel: '9/19',
        tooltipTitle: '9月19日',
        added: 3,
        removed: 1,
        note: null,
      },
      {
        key: '2026-09-20',
        axisLabel: '9/20',
        tooltipTitle: '9月20日',
        added: 6,
        removed: 0,
        note: '朝の配信',
      },
      {
        key: '2026-09-21',
        axisLabel: '9/21',
        tooltipTitle: '9月21日',
        added: 0,
        removed: 2,
        note: null,
      },
    ])
  })

  it('目盛りは上端が最大値を包むきりの良い段', () => {
    expect(barChartTicks(6)).toEqual([0, 2, 4, 6])
    expect(barChartTicks(0)).toEqual([0, 1])
    expect(barChartTicks(30)).toEqual([0, 10, 20, 30])
  })
})

describe('色は2つまで（増えた=濃い緑・減った=灰色）', () => {
  it('増えた棒は accent-deep、減った棒は ink-faint', () => {
    expect(css).toMatch(/\.addedBar\s*\{[^}]*var\(--color-accent-deep\)/s)
    expect(css).toMatch(/\.removedBar\s*\{[^}]*var\(--color-ink-faint\)/s)
  })

  it('赤・3つ目の色を使わない', () => {
    expect(tsx).not.toMatch(/danger|#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/danger|#[0-9a-fA-F]{3,8}\b/)
  })

  it('凡例は「増えた」「減った」の文字を持つ', () => {
    render(<BarChart items={SAMPLE} />)
    const legend = screen.getByRole('list', { name: '凡例' })
    expect(legend.textContent).toContain('増えた')
    expect(legend.textContent).toContain('減った')
  })
})

describe('数字は文字でも読める（色だけに頼らない）', () => {
  it('1日のボタン名に数が入る', () => {
    render(<BarChart items={SAMPLE} />)
    expect(
      screen.getByRole('button', { name: '9月20日 増えた6人・減った0人・朝の配信' }),
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: '9月21日 増えた0人・減った2人' })).not.toBeNull()
  })

  it('読み上げ用の表が同じ数を持つ', () => {
    render(<BarChart items={SAMPLE} />)
    const table = document.querySelector('table') as HTMLTableElement
    expect(table.textContent).toContain('9月20日')
    expect(table.textContent).toContain('6人')
    expect(table.textContent).toContain('0人')
    expect(table.textContent).toContain('2人')
  })
})

describe('押せる範囲は列全体・選んだ日が分かる', () => {
  it('押すとその日が選ばれ、aria-pressed が立つ', () => {
    let picked = ''
    render(<BarChart items={SAMPLE} selectedKey="2026-09-19" onSelect={(key) => { picked = key }} />)
    const first = screen.getByRole('button', { name: '9月19日 増えた3人・減った1人' })
    expect(first.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '9月20日 増えた6人・減った0人・朝の配信' }))
    expect(picked).toBe('2026-09-20')
  })

  it('キーボードのフォーカスが見える（CSSの指定）', () => {
    expect(css).toMatch(/:focus-visible/)
  })
})

describe('まだ数えられないとき', () => {
  it('0 の棒を並べず、何がそろえば出るかを書く', () => {
    render(<BarChartEmpty title="7日分たまると表示します" detail="いまは 3日分（9月21日から）" />)
    expect(screen.getByText('7日分たまると表示します')).not.toBeNull()
    expect(screen.getByText('いまは 3日分（9月21日から）')).not.toBeNull()
    expect(document.querySelectorAll('button').length).toBe(0)
  })
})

describe('分析画面の配線（見た目と数字の一致）', () => {
  it('日ごとの増減の枠が BarChart を使う', () => {
    expect(analyticsPage).toContain("from '@/components/shared/bar-chart'")
    expect(analyticsPage).toContain('<BarChart')
    expect(analyticsPage).toContain('toBarChartItems(overview.days')
  })

  it('減った棒に赤を使わない', () => {
    expect(analyticsPage).not.toContain('rounded-b bg-danger')
  })

  it('日ごとの数は overview.days の増減をそのまま渡す', () => {
    expect(analyticsPage).toContain('overview.campaigns')
    // 選択日の1行は BarChart の外で今までどおり出す。
    expect(analyticsPage).toContain('増加 {selectedDay.added}人・減少 {selectedDay.removed}人')
  })
})
