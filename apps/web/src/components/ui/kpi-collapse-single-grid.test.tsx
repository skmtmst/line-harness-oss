// @vitest-environment happy-dom
/*
 * DASH-22 の固定検査。
 *
 * 「今日やること」の4枚がPC幅でも2×2の左半分にしか並ばなかったのは、
 * 先頭2件と残りを別グリッドに分けていたため。ここでは実DOMへ置いて、
 * ・全件が1つのグリッドに並ぶ
 * ・末尾だけが狭い幅で隠れる（共通部品側の包みで制御する）
 * ・「集計を見る」で隠しが外れる
 * ことを固定する。
 *
 * R171: 隠しを各カードへの `className` 付け足しで表すと、`className` を
 * 受け取らないカード（実行履歴の Metric など）は隠せず4枚とも残る。
 * 包み div の側で隠すため、ここでは `className` を受け取らない子でも
 * 隠れることを見る。
 */
import React from 'react'
import { afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import KpiCollapse from './kpi-collapse'

afterEach(() => cleanup())

function renderFour() {
  return render(
    <KpiCollapse gridClassName="grid grid-cols-4 probe-grid">
      <div>A</div>
      <div>B</div>
      <div>C</div>
      <div>D</div>
    </KpiCollapse>,
  )
}

/** `className` を受け取らない集計カード（R171 の Metric と同じ形）。 */
function MetricLike({ label }: { label: string }) {
  return (
    <section>
      <p>{label}</p>
    </section>
  )
}

function renderMetricLike() {
  return render(
    <KpiCollapse gridClassName="grid grid-cols-4 probe-grid">
      <MetricLike label="A" />
      <MetricLike label="B" />
      <MetricLike label="C" />
      <MetricLike label="D" />
    </KpiCollapse>,
  )
}

describe('KpiCollapse の単一グリッド（DASH-22）', () => {
  it('4件のカードは1つのグリッドへ全て並ぶ', () => {
    const { container } = renderFour()
    const grids = container.querySelectorAll('.probe-grid')
    expect(grids.length).toBe(1)
    expect(grids[0]!.children.length).toBe(4)
  })

  it('末尾だけが狭い幅で隠れる（共通部品側の包みで制御する）', () => {
    const { container } = renderFour()
    const grid = container.querySelector('.probe-grid')!
    expect(grid.children[0]!.className).not.toContain('max-sm:hidden')
    expect(grid.children[1]!.className).not.toContain('max-sm:hidden')
    expect(grid.children[2]!.className).toContain('max-sm:hidden')
    expect(grid.children[3]!.className).toContain('max-sm:hidden')
  })

  it('「集計を見る」で末尾の隠しが外れ、閉じると戻る', () => {
    const { container } = renderFour()
    const grid = container.querySelector('.probe-grid')!
    fireEvent.click(screen.getByRole('button', { name: /集計を見る/ }))
    expect(grid.children[2]!.className).not.toContain('max-sm:hidden')
    fireEvent.click(screen.getByRole('button', { name: '集計を閉じる' }))
    expect(grid.children[2]!.className).toContain('max-sm:hidden')
  })

  it('R171: className を受け取らないカードでも閉じると隠れる', () => {
    const { container } = renderMetricLike()
    const grid = container.querySelector('.probe-grid')!
    // 中の section には隠しクラスを付けられない。包みが隠す。
    expect(grid.querySelectorAll('section').length).toBe(4)
    for (const section of grid.querySelectorAll('section')) {
      expect(section.className).not.toContain('max-sm:hidden')
    }
    const wrappers = [...grid.children]
    expect(wrappers[0]!.className).not.toContain('max-sm:hidden')
    expect(wrappers[1]!.className).not.toContain('max-sm:hidden')
    expect(wrappers[2]!.className).toContain('max-sm:hidden')
    expect(wrappers[3]!.className).toContain('max-sm:hidden')
    fireEvent.click(screen.getByRole('button', { name: /集計を見る/ }))
    expect(wrappers[2]!.className).not.toContain('max-sm:hidden')
    fireEvent.click(screen.getByRole('button', { name: '集計を閉じる' }))
    expect(wrappers[2]!.className).toContain('max-sm:hidden')
  })

  it('先頭の枠内に収まるなら開閉ボタンを出さずそのまま並べる', () => {
    const { container, queryByRole } = render(
      <KpiCollapse gridClassName="grid probe-grid">
        <div>A</div>
        <div>B</div>
      </KpiCollapse>,
    )
    expect(container.querySelector('.probe-grid')!.children.length).toBe(2)
    expect(queryByRole('button')).toBeNull()
  })
})
